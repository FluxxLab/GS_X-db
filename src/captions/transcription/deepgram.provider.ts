import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepgramClient } from '@deepgram/sdk';
import type {
  TranscriptEvent,
  TranscriptionProvider,
  TranscriptionStream,
} from './transcription.interface';

/**
 * Deepgram labels each word with a speaker, not each segment, so the segment
 * belongs to whoever said most of it. A segment that straddles a handover is
 * attributed to the dominant voice rather than split.
 */
function dominantSpeaker(
  words: { speaker?: number }[] | undefined,
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
    opts: { room: string; keywords: string[] },
    onTranscript: (event: TranscriptEvent) => void,
  ): Promise<TranscriptionStream> {
    const conn = await this.client.listen.v1.connect({
      model: 'nova-3',
      language: 'en',
      smart_format: 'true',
      interim_results: 'true',
      keyterm: opts.keywords,
      // v1 is the only diarisation model streaming accepts; v2 is batch-only
      // and returns a validation error here.
      diarize_model: 'v1',
    });

    conn.on('message', (message) => {
      if (message.type !== 'Results') return; //union also carries Metadata/UtteranceEnd/SpeechStarted
      const alternative = message.channel?.alternatives?.[0];
      const text = alternative?.transcript;
      if (!text) return;

      onTranscript({
        text,
        isFinal: message.is_final === true,
        speaker: dominantSpeaker(alternative?.words),
      });
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
