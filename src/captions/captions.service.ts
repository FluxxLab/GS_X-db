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
import { createHash } from 'node:crypto';
import { CaptionLanguage } from './translation/languages';
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
  private static readonly CONTEXT_LINES = 3;

  constructor(
    @InjectRepository(TranscriptSegment)
    private readonly segments: Repository<TranscriptSegment>,
    @Inject(TRANSCRIPTION_PROVIDER)
    private readonly transcription: TranscriptionProvider,
    @Inject(TRANSLATION_PROVIDER)
    private readonly translation: TranslationProvider,
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
      await this.segments.save(
        this.segments.create({
          sessionId: session.id,
          room,
          text: event.text,
          speaker: event.speaker ?? null,
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
      const context = this.recentFinals.get(session.id) ?? [];
      void this.translateAndEmit(
        session.id,
        event.text,
        context,
        event.speaker,
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
  ): Promise<void> {
    try {
      const translations = await this.translate(text, context);
      const at = new Date().toISOString();

      for (const [language, translated] of Object.entries(translations)) {
        if (!translated) continue;
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

    const translations = await this.translation.translate(text, context);
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

  fullTranscript(sessionId: string): Promise<TranscriptSegment[]> {
    return this.segments.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
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
