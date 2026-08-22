import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepgramClient } from '@deepgram/sdk';
import type {
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

  async openStream(
    opts: { room: string; keywords: string[]; diarise?: boolean },
    onTranscript: (event: TranscriptEvent) => void,
  ): Promise<TranscriptionStream> {
    const conn = await this.client.listen.v1.connect({
      model: 'nova-3',
      language: 'en',
      smart_format: 'true',
      interim_results: 'true',
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
    conn.on('close', () =>
      this.logger.warn(`Deepgram stream closed (${opts.room})`),
    );

    conn.connect(); //registers handler and open the socket...
    await conn.waitForOpen(); // ..and this resolves once its actually open
    this.logger.log(`Deepgram stream open (${opts.room})`);

    return {
      sendAudio: (chuck) => conn.sendMedia(chuck),
      close: async () => conn.close(),
    };
  }
}
