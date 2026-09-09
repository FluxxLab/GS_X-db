import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepgramClient } from '@deepgram/sdk';
import { createReadStream } from 'node:fs';
import type {
  ArchiveUtterance,
  TranscriptEvent,
  TranscriptionProvider,
  TranscriptionStream,
} from './transcription.interface';

interface DiarisedWord {
  word?: string;
  punctuated_word?: string;
  speaker?: number;
}

interface SpeakerRun {
  text: string;
  speaker?: number;
}

/**
 * Deepgram labels each *word* with a speaker, and a single final regularly
 * spans a handover - a question and its answer arrive together.
 *
 * Attributing the whole final to whoever said most of it erases anyone who
 * only interjects, which is indistinguishable from diarisation failing: one
 * voice appears to hold the floor for the entire session. Splitting at each
 * speaker change keeps both, at the cost of shorter segments.
 */
function speakerRuns(
  words: DiarisedWord[] | undefined,
  fallbackText: string,
): SpeakerRun[] {
  if (!words?.length) return [{ text: fallbackText }];

  const runs: SpeakerRun[] = [];
  for (const word of words) {
    // punctuated_word carries smart_format's punctuation and casing.
    const token = word.punctuated_word ?? word.word;
    if (!token) continue;

    const current = runs[runs.length - 1];
    if (current && current.speaker === word.speaker) {
      current.text += ` ${token}`;
    } else {
      runs.push({ text: token, speaker: word.speaker });
    }
  }

  return runs.length > 0 ? runs : [{ text: fallbackText }];
}

/** Whoever said most of a fragment. Interims are revised constantly, so they
 *  get one speaker rather than being split into flickering runs. */
function dominantSpeaker(
  words: DiarisedWord[] | undefined,
): number | undefined {
  if (!words?.length) return undefined;

  const counts = new Map<number, number>();
  for (const word of words) {
    if (word.speaker === undefined) continue;
    counts.set(word.speaker, (counts.get(word.speaker) ?? 0) + 1);
  }

  let dominant: number | undefined;
  let best = 0;
  for (const [speaker, count] of counts) {
    if (count > best) {
      dominant = speaker;
      best = count;
    }
  }
  return dominant;
}

@Injectable()
export class DeepTranscriptionProvider implements TranscriptionProvider {
  private readonly logger = new Logger(DeepTranscriptionProvider.name);
  private readonly client: DeepgramClient;
  constructor(config: ConfigService) {
    this.client = new DeepgramClient({
      apiKey: config.getOrThrow<string>('DEEPGRAM_API_KEY'),
    });
  }

  /**
   * The archive pass. diarize_model v2 is batch-only - streaming rejects it -
   * and it is the reason this exists: v2 reads the whole recording before
   * deciding who spoke, instead of guessing incrementally as the audio
   * arrives. utterances gives speaker-segmented turns directly, so there is
   * no word-run stitching to do here.
   */
  async archive(
    filePath: string,
    opts: { keywords: string[] },
  ): Promise<ArchiveUtterance[]> {
    const response = await this.client.listen.v1.media.transcribeFile(
      createReadStream(filePath),
      {
        model: 'nova-3',
        language: 'en',
        smart_format: true,
        // Masked at the source here too, so the archive pass cannot restore
        // words the live captions had already removed.
        profanity_filter: true,
        diarize_model: 'v2',
        utterances: true,
        keyterm: opts.keywords,
      },
    );

    const utterances =
      'results' in response ? (response.results.utterances ?? []) : [];

    return utterances
      .filter((u) => u.transcript && u.transcript.trim().length > 0)
      .map((u) => ({
        text: u.transcript as string,
        speaker: u.speaker,
        offsetMs: Math.round((u.start ?? 0) * 1000),
      }));
  }

  async openStream(
    opts: {
      room: string;
      keywords: string[];
      diarise?: boolean;
      onReopen?: () => void;
    },
    onTranscript: (event: TranscriptEvent) => void,
  ): Promise<TranscriptionStream> {
    /**
     * Deepgram's socket does not stay open for a whole summit day. It closes
     * on its own idle timeout, on a network blip between us and them, and on
     * their side during a deploy. Until now that was only logged: audio kept
     * being written into a dead socket and not one caption arrived again
     * until the operator stopped and restarted capture at the desk, which is
     * exactly what the caption desk reported on 9 September 2026.
     *
     * So the stream reopens itself. `current` is whatever connection is live
     * now, `closing` tells a deliberate shutdown apart from a drop, and the
     * handle handed back always writes to the current connection.
     */
    let current: Awaited<ReturnType<typeof this.connect>> | null = null;
    let closing = false;
    let attempt = 0;
    let keepAlive: NodeJS.Timeout | null = null;

    const open = async (): Promise<void> => {
      const conn = await this.connect(opts, onTranscript, () => {
        // unexpected close: back off a little, then take the room back
        if (closing) return;
        const wait = Math.min(10_000, 500 * 2 ** attempt++);
        this.logger.warn(
          `Deepgram stream dropped (${opts.room}); reopening in ${wait}ms`,
        );
        setTimeout(() => {
          if (closing) return;
          void open().catch((e: Error) =>
            this.logger.error(
              `Deepgram reopen failed (${opts.room}): ${e.message}`,
            ),
          );
        }, wait);
      });
      const isReopen = current !== null;
      current = conn;
      attempt = 0;
      this.logger.log(`Deepgram stream open (${opts.room})`);
      // Ask the desk for a fresh recording, or this stream is fed the middle
      // of a WebM container and will be dropped again in seconds.
      if (isReopen) opts.onReopen?.();
    };

    await open();

    /**
     * Deepgram closes a stream that has gone quiet for about ten seconds. A
     * capture desk between sessions, or one whose browser tab has been
     * throttled, sends nothing for far longer than that, so the connection
     * would be torn down mid-break and the next speaker would go uncaptioned.
     */
    keepAlive = setInterval(() => {
      if (closing) return;
      try {
        current?.sendKeepAlive({ type: 'KeepAlive' });
      } catch {
        // the reopen path covers a connection too far gone for this
      }
    }, 5000);

    return {
      sendAudio: (chunk) => current?.sendMedia(chunk),
      // close() is synchronous on the socket; the signature stays a promise
      // because the interface every provider implements returns one
      close: () => {
        closing = true;
        if (keepAlive) clearInterval(keepAlive);
        current?.close();
        return Promise.resolve();
      },
    };
  }

  /** One Deepgram connection, wired up. `onClose` fires on every close. */
  private async connect(
    opts: { room: string; keywords: string[]; diarise?: boolean },
    onTranscript: (event: TranscriptEvent) => void,
    onClose: () => void,
  ) {
    const conn = await this.client.listen.v1.connect({
      model: 'nova-3',
      language: 'en',
      smart_format: 'true',
      interim_results: 'true',
      // Deepgram masks what it recognises before the text reaches us, so the
      // stored transcript is masked as well and the real words are not
      // recoverable afterwards. A second pass in profanity.ts covers what this
      // list does not know, Nigerian slang in particular.
      profanity_filter: 'true',
      keyterm: opts.keywords,
      // v1 is the only diarisation model streaming accepts; v2 is batch-only
      // and returns a validation error here. Omitted entirely for a
      // single-voice room rather than set false, so no speaker field comes
      // back at all and the UI renders unlabelled lines.
      ...(opts.diarise === false ? {} : { diarize_model: 'v1' }),
      /**
       * Deepgram's default endpointing is 10ms, which finalises on the
       * shortest pause and produces fragments that end mid-phrase. That hurts
       * diarisation more than anything else available here: the fewer words in
       * a final, the less evidence the diariser has to attribute them, so
       * short turns get swept into whoever was speaking before.
       *
       * 400ms waits for a real breath instead of a syllable gap. Captions
       * appear a fraction later; turns are whole and attribution is steadier.
       */
      endpointing: '400',
      utterance_end_ms: '1200',
      vad_events: 'true',
    });

    /**
     * Highest speaker index this stream has ever produced. Logged when it
     * grows, so "everyone reads as one speaker" can be told apart from a
     * problem downstream: if this never reaches 2, Deepgram genuinely is not
     * separating the voices and the microphone is the thing to fix.
     */
    let voicesHeard = 0;

    conn.on('message', (message) => {
      if (message.type !== 'Results') return; //union also carries Metadata/UtteranceEnd/SpeechStarted
      const alternative = message.channel?.alternatives?.[0];
      const text = alternative?.transcript;
      if (!text) return;

      const words = alternative?.words as DiarisedWord[] | undefined;

      if (message.is_final !== true) {
        onTranscript({ text, isFinal: false, speaker: dominantSpeaker(words) });
        return;
      }

      for (const run of speakerRuns(words, text)) {
        if (run.speaker !== undefined && run.speaker + 1 > voicesHeard) {
          voicesHeard = run.speaker + 1;
          this.logger.log(
            `Deepgram separating ${voicesHeard} voice(s) (${opts.room})`,
          );
        }
        onTranscript({ text: run.text, isFinal: true, speaker: run.speaker });
      }
    });
    conn.on('error', (e) =>
      this.logger.error(`Deepgram error (${opts.room}): ${e.message}`),
    );
    conn.on('close', () => {
      this.logger.warn(`Deepgram stream closed (${opts.room})`);
      onClose();
    });

    conn.connect(); //registers handler and open the socket...
    await conn.waitForOpen(); // ..and this resolves once its actually open
    return conn;
  }
}
