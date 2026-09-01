import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { TranscriptSegment } from './entities/transcript-segment.entity';
import { TRANSCRIPTION_PROVIDER } from './transcription/transcription.interface';
import type {
  TranscriptEvent,
  TranscriptionProvider,
  TranscriptionStream,
} from './transcription/transcription.interface';
import { REDIS } from 'src/common/redis/redis.module';
import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CaptionLanguage } from './translation/languages';
import { dropVerdicts } from './translation/verdict-filter';
import { TRANSLATION_PROVIDER } from './translation/translation.interface';
import type {
  TranslationProvider,
  Translations,
} from './translation/translation.interface';

/**
 * extends from the agenda
 */
const SUMMIT_KEYWORDS = ['Pitchathon', 'GBV', 'GS-26'];

@Injectable()
export class CaptionsService implements OnModuleDestroy {
  private readonly logger = new Logger(CaptionsService.name);

  /**
   * Connection state, not domain states: each Deepgram stream is bound to the instance
   * holding the capture socket; caption fan-out still reaches every instance via the Redis adapter.
   */
  private readonly activeRooms = new Map<string, TranscriptionStream>();

  /**
   * Audio that arrived while Deepgram was still connecting. The first
   * MediaRecorder chunk carries the WebM/EBML header; every later chunk is a
   * bare Opus cluster that cannot be decoded without it. Dropping the header
   * because the stream was not open yet makes Deepgram reject the audio and
   * close the socket, so these are queued and flushed in order instead.
   */
  private readonly pendingAudio = new Map<string, Buffer[]>();

  /**
   * The last few English finals per session, passed to the translator as
   * context. Fragments are short and often start mid-thought - more so since
   * finals are split at speaker changes - and without the preceding lines the
   * model has to guess at pronouns and continuations, which is where most
   * fluent-but-wrong output comes from.
   */
  private readonly recentFinals = new Map<string, string[]>();

  /**
   * A copy of the room's audio on disk, kept only until the archive pass has
   * read it. Written alongside the Deepgram stream rather than instead of it:
   * the live captions still have to arrive in real time.
   */
  private readonly recordings = new Map<
    string,
    { path: string; file: WriteStream }
  >();

  /**
   * The session each room was last captioning. Read at stop time, because by
   * then an operator has usually already marked the session completed and
   * findLiveInRoom would return nothing.
   */
  private readonly lastSession = new Map<string, string>();
  private static readonly CONTEXT_LINES = 3;

  constructor(
    @InjectRepository(TranscriptSegment)
    private readonly segments: Repository<TranscriptSegment>,
    @Inject(TRANSCRIPTION_PROVIDER)
    private readonly transcription: TranscriptionProvider,
    @Inject(TRANSLATION_PROVIDER)
    private readonly translation: TranslationProvider,
    @InjectQueue('captions-archive')
    private readonly archiveQueue: Queue,
    @InjectQueue('caption-gapfill')
    private readonly gapfillQueue: Queue,
    private readonly session: SessionsService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS)
    private readonly redis: Redis,
  ) {}

  async startRoom(room: string, diarise = true): Promise<void> {
    // indempotent - capture page reconnect happen
    if (this.activeRooms.has(room) || this.pendingAudio.has(room)) return;

    this.pendingAudio.set(room, []);
    let stream: TranscriptionStream;
    try {
      stream = await this.transcription.openStream(
        { room, keywords: SUMMIT_KEYWORDS, diarise },
        (event) =>
          void this.onTranscript(room, event).catch((error) =>
            /**
             * Fire-and-forget by design, so without this a failure here -
             * a missing column, a dropped connection - disappears entirely
             * and captions simply stop being saved with nothing to explain
             * why.
             */
            this.logger.error(
              `caption handling failed (${room}): ${(error as Error).message}`,
            ),
          ),
      );
    } catch (error) {
      this.pendingAudio.delete(room);
      throw error;
    }
    this.activeRooms.set(room, stream);

    // Same bytes the live stream gets, kept for the higher-quality pass later.
    const path = join(tmpdir(), 'gs26-capture-' + randomUUID() + '.webm');
    this.recordings.set(room, { path, file: createWriteStream(path) });

    const queued = this.pendingAudio.get(room) ?? [];
    this.pendingAudio.delete(room);
    for (const chunk of queued) this.sendAudio(room, chunk);

    await this.redis.set(
      this.captureKey(room),
      new Date().toISOString(),
      'EX',
      30,
    );
  }

  sendAudio(room: string, chunk: Buffer): void {
    const queue = this.pendingAudio.get(room);
    if (queue) {
      queue.push(chunk);
      return;
    }

    const stream = this.activeRooms.get(room);
    if (!stream) return;

    // Written before the send, so a Deepgram failure cannot cost us the audio.
    this.recordings.get(room)?.file.write(chunk);

    try {
      stream.sendAudio(chunk);
    } catch (error) {
      /**
       * Deepgram hung up. Forget the room rather than throw once per 250ms
       * chunk: the capture heartbeat then expires and live-ops shows the room
       * unhealthy, which is the signal an operator can act on.
       */
      this.activeRooms.delete(room);
      this.logger.warn(
        `Deepgram stream unusable (${room}): ${(error as Error).message}`,
      );
    }
  }

  async stopRoom(room: string): Promise<void> {
    this.pendingAudio.delete(room);
    await this.activeRooms.get(room)?.close();
    await this.redis.del(this.captureKey(room));
    this.activeRooms.delete(room);

    await this.queueArchive(room);
  }

  /**
   * Hand the finished recording to the archive pass.
   *
   * Queued rather than awaited: re-transcribing an hour of audio takes
   * minutes, and caption:stop is a socket handler an operator is waiting on.
   * Nothing here is allowed to throw - the live transcript already exists,
   * and a failed archive must not break stopping a capture.
   */
  private async queueArchive(room: string): Promise<void> {
    const recording = this.recordings.get(room);
    this.recordings.delete(room);
    const sessionId = this.lastSession.get(room);
    this.lastSession.delete(room);

    if (!recording) return;
    await new Promise<void>((resolve) => recording.file.end(resolve));

    // No session means nothing was ever live in this room, so the audio has
    // nowhere to attach. Drop the file rather than leaving it in tmp.
    if (!sessionId) {
      await unlink(recording.path).catch(() => {});
      return;
    }

    try {
      await this.archiveQueue.add('retranscribe', {
        sessionId,
        room,
        path: recording.path,
      });
    } catch (error) {
      this.logger.warn(
        `could not queue archive for ${room}: ${(error as Error).message}`,
      );
      await unlink(recording.path).catch(() => {});
    }
  }

  isActive(room: string): boolean {
    return this.activeRooms.has(room);
  }

  private async onTranscript(
    room: string,
    event: TranscriptEvent,
  ): Promise<void> {
    await this.redis.set(
      this.captureKey(room),
      new Date().toISOString(),
      'EX',
      30,
    );
    const session = await this.session.findLiveInRoom(room);
    if (!session) return; // break time - nothing live in this room, drop the fragment

    this.realtime.emitToRoom(Rooms.caption(session.id), 'caption', {
      sessionId: session.id,
      text: event.text,
      isFinal: event.isFinal,
      aiGenerated: true,
      language: CaptionLanguage.EN,
      speaker: event.speaker,
      at: new Date().toISOString(),
    });

    if (event.isFinal) {
      // kept: each translation row points back at the English it came from
      const englishSegment = await this.segments.save(
        this.segments.create({
          sessionId: session.id,
          room,
          text: event.text,
          speaker: event.speaker ?? null,
          language: 'en',
        }),
      );

      /**
       * Finals only. Interim results are revised several times a second, so
       * translating them would multiply the bill for text that visibly
       * rewrites itself, and a final lands on a phrase boundary where
       * translation quality is best.
       *
       * Deliberately not awaited: a slow translation must never delay the
       * English caption, which is the one on the screen in the room.
       */
      // Captured before the current line is appended: the model needs what
      // came before, not the fragment it is already being given.
      this.lastSession.set(room, session.id);
      const context = this.recentFinals.get(session.id) ?? [];
      void this.translateAndEmit(
        session.id,
        event.text,
        context,
        event.speaker,
        room,
        englishSegment.id,
      );
      this.recentFinals.set(
        session.id,
        [...context, event.text].slice(-CaptionsService.CONTEXT_LINES),
      );
    }
  }

  private async translateAndEmit(
    sessionId: string,
    text: string,
    context: string[],
    speaker: number | undefined,
    room: string,
    sourceSegmentId: string,
  ): Promise<void> {
    try {
      const translations = await this.translate(text, context);
      const at = new Date().toISOString();

      for (const [language, translated] of Object.entries(translations)) {
        if (!translated) continue;

        /**
         * Source and result together, so a wrong translation can be proved
         * rather than argued about. Debug level: this is four lines per
         * caption, which is too much for normal running but exactly what is
         * needed while the translation quality is being judged.
         */
        this.logger.debug(
          `[${language}] "${text.slice(0, 70)}" -> "${translated.slice(0, 70)}"`,
        );

        /**
         * Persisted, not just broadcast. Without this a delegate joining a
         * session late could only ever be backfilled in English, and a
         * reconnect lost every translated line said while they were away.
         *
         * Saved before the emit and not awaited as a block: the write must not
         * delay the caption reaching the screen, but a failure here should not
         * stop the broadcast either - the live line matters more than the row.
         */
        void this.segments
          .save(
            this.segments.create({
              sessionId,
              room,
              text: translated,
              speaker: speaker ?? null,
              language,
              sourceSegmentId,
            }),
          )
          .catch((error) =>
            this.logger.warn(
              `failed to persist ${language} segment for ${sessionId}: ${error}`,
            ),
          );

        this.realtime.emitToRoom(
          Rooms.caption(sessionId, language),
          'caption',
          {
            sessionId,
            text: translated,
            isFinal: true,
            aiGenerated: true,
            language,
            /**
             * Carried through from the English final. A delegate reading in
             * Yoruba needs to know who is speaking just as much as one
             * reading English, and the label is rendered by the client, so it
             * never goes through the translator.
             */
            speaker,
            at,
          },
        );
      }
    } catch (error) {
      // Translation is additive. English captions carry on regardless.
      this.logger.warn(
        `translation failed (${sessionId}): ${(error as Error).message}`,
      );
    }
  }

  private async translate(
    text: string,
    context: string[],
  ): Promise<Translations> {
    /**
     * Context is part of the key: the same fragment translated after different
     * preceding lines is a different translation, and serving a cached one
     * from the wrong context is worse than paying for the call. Repeated
     * stock phrases still hit, which is where most of the saving was anyway.
     */
    const hash = createHash('sha1');
    for (const line of context) hash.update(line).update('|');
    hash.update(text);
    const key = `caption:tr:${hash.digest('hex')}`;

    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as Translations;

    const raw = await this.translation.translate(text, context);

    /**
     * Filtered before it is cached, so a verdict cannot be served from Redis
     * for the next 24 hours after slipping through once.
     */
    const { kept: translations, dropped } = dropVerdicts(text, raw);
    if (dropped.length > 0) {
      this.logger.warn(
        `dropped ${dropped.join(', ')} - translator commented on the fragment instead of translating it: "${text.slice(0, 70)}"`,
      );
    }

    if (Object.keys(translations).length > 0) {
      // Sessions repeat terminology constantly - titles, names, recurring
      // phrases - so a day of captions hits this often enough to matter.
      await this.redis.set(
        key,
        JSON.stringify(translations),
        'EX',
        60 * 60 * 24,
      );
    }
    return translations;
  }

  /**
   * The tail of a session's captions, for a delegate joining late.
   *
   * Capped rather than complete: a two-hour plenary is thousands of rows, and
   * a delegate wants the thread of what is being said now, not the whole
   * morning. Returned oldest-first so the client can prepend it to the live
   * feed without re-sorting.
   */
  async recentCaptions(
    sessionId: string,
    language = 'en',
    limit = 60,
  ): Promise<{ text: string; speaker: number | null; at: Date }[]> {
    const rows = await this.segments.find({
      where: { sessionId, language },
      order: { offsetMs: 'DESC', createdAt: 'DESC' },
      take: limit,
    });

    // A translation this language is missing gets filled in the background,
    // never in this request. Filling it here meant a delegate's catch-up call
    // waited on a dozen Claude round-trips: the calls timed out, nothing was
    // persisted, and the next reader asked for exactly the same work again.
    // The job persists what it translates and pushes each line out on this
    // language's caption room, so the history arrives on the open screen a
    // moment later instead of holding the response hostage.
    if (language !== 'en') void this.queueTranslationGapFill(sessionId, language);

    return rows
      .reverse()
      .map((r) => ({ text: r.text, speaker: r.speaker, at: r.createdAt }));
  }

  /**
   * One job per session and language at a time. The jobId is the dedupe: five
   * delegates opening the same session in Hausa queue one fill between them,
   * not five identical ones racing to translate the same rows.
   */
  private async queueTranslationGapFill(
    sessionId: string,
    language: string,
  ): Promise<void> {
    try {
      await this.gapfillQueue.add(
        'fill',
        { sessionId, language },
        {
          jobId: `gapfill:${sessionId}:${language}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      // Catch-up still returns what exists; a queue that is down must not turn
      // a readable history into a failed request.
      this.logger.warn(
        `could not queue ${language} gap-fill for ${sessionId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Translate the English lines this language is missing, on demand.
   *
   * Translations are produced live, as each final lands. Anything said while
   * the translator was unreachable, or before a session's captions were being
   * translated at all, therefore has an English row and nothing else - and a
   * delegate switching to Hausa mid-session saw a short history or an empty
   * one, with no way to ever recover those lines.
   *
   * So the gap is filled from the English rows the moment someone asks for
   * that language, and persisted, which means it is paid for once no matter
   * how many delegates read it afterwards. The service-level cache in
   * translate() usually absorbs even that.
   *
   * Runs on the caption-gapfill queue, never on the request that triggered it
   * - see recentCaptions. Each line it saves is emitted on that language's
   * caption room, so a delegate already looking at the screen watches the
   * history fill in rather than having to reopen it.
   *
   * Bounded deliberately: only the most recent GAP_FILL_MAX lines, a few at a
   * time. The thread of what is being said now is worth more than a complete
   * morning that costs a hundred translate calls to assemble.
   */
  private static readonly GAP_FILL_MAX = 12;
  private static readonly GAP_FILL_CONCURRENCY = 4;

  async fillTranslationGaps(
    sessionId: string,
    language: string,
  ): Promise<TranscriptSegment[]> {
    const [english, existing] = await Promise.all([
      this.segments.find({
        where: { sessionId, language: 'en' },
        order: { offsetMs: 'DESC', createdAt: 'DESC' },
        take: 60,
      }),
      this.segments.find({
        where: { sessionId, language },
        order: { offsetMs: 'DESC', createdAt: 'DESC' },
        take: 60,
      }),
    ]);
    if (english.length === 0) return [];

    const translated = new Set(
      existing.map((r) => r.sourceSegmentId).filter(Boolean),
    );
    // newest first, so a capped fill covers what they are reading right now
    const missing = english
      .filter((r) => !translated.has(r.id))
      .slice(0, CaptionsService.GAP_FILL_MAX);
    if (missing.length === 0) return [];

    this.logger.log(
      `translating ${missing.length} missing ${language} caption(s) for ${sessionId}`,
    );

    const saved: TranscriptSegment[] = [];
    for (
      let i = 0;
      i < missing.length;
      i += CaptionsService.GAP_FILL_CONCURRENCY
    ) {
      const batch = missing.slice(i, i + CaptionsService.GAP_FILL_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (source) => {
          try {
            // No context: the surrounding lines are not reliably present for
            // an old fragment, and a wrong context is worse than none.
            const translations = await this.translate(source.text, []);
            const text = translations[language as CaptionLanguage];
            if (!text) return null;
            return await this.segments.save(
              this.segments.create({
                sessionId,
                room: source.room,
                text,
                speaker: source.speaker,
                language,
                sourceSegmentId: source.id,
                offsetMs: source.offsetMs,
              }),
            );
          } catch (error) {
            this.logger.warn(
              `gap-fill failed for ${source.id}: ${(error as Error).message}`,
            );
            return null;
          }
        }),
      );
      saved.push(...results.filter((r): r is TranscriptSegment => r !== null));
    }

    // Oldest first, so a screen appending them reads in the order it was said.
    saved.sort(
      (a, b) =>
        (a.offsetMs ?? 0) - (b.offsetMs ?? 0) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (const row of saved) {
      this.realtime.emitToRoom(Rooms.caption(sessionId, language), 'caption', {
        sessionId,
        text: row.text,
        isFinal: true,
        // Backfill, not something just said - the client uses this to append
        // to the history rather than the live thread.
        backfill: true,
        aiGenerated: true,
        language,
        speaker: row.speaker,
      });
    }
    return saved;
  }

  /**
   * One session's transcript in one language.
   *
   * The language filter is not optional: since translations are persisted
   * alongside the English rows, an unfiltered query returns every language
   * interleaved, which reads as a corrupted transcript rather than a complete
   * one. Defaults to English so existing admin callers are unchanged.
   */
  fullTranscript(
    sessionId: string,
    language = 'en',
  ): Promise<TranscriptSegment[]> {
    return this.segments.find({
      where: { sessionId, language },
      /**
       * Archived rows carry an offset and are all written in one insert, so
       * createdAt cannot order them. Live rows have a null offset and sort
       * last under Postgres' ASC default, which is right: a session is
       * either archived or it is not, never half of each.
       */
      order: { offsetMs: 'ASC', createdAt: 'ASC' },
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const [room, stream] of this.activeRooms) {
      await stream
        .close()
        .catch(() => this.logger.warn(`close failed (${room})`));
    }
  }

  private captureKey(room: string) {
    return `capture: room: ${room}`;
  }
}
