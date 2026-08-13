import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepgramClient } from '@deepgram/sdk';
import type {
  TranscriptEvent, TranscriptionProvider, TranscriptionStream,
} from './transcription.interface';

@Injectable()
export class DeepTranscriptionProvider implements TranscriptionProvider {
    private readonly logger = new Logger(DeepTranscriptionProvider.name);
    private readonly client: DeepgramClient;
    constructor(
        config: ConfigService,
    ){
        this.client = new DeepgramClient({
            apiKey: config.getOrThrow<string>('DEEPGRAM_API_KEY'),
        });
    }

    async openStream(
        opts: {room:  string; keywords: string[]},
        onTranscript: (event: TranscriptEvent) => void,
    ): Promise<TranscriptionStream> {

        const conn = await this.client.listen.v1.connect({
            model: 'nova-3',
            language: 'en',
            smart_format: 'true',
            interim_results: 'true',
            keyterm: opts.keywords,
        });

        conn.on('message', (message) => {
            if(message.type !== 'Results') return; //union also carries Metadata/UtteranceEnd/SpeechStarted
            const text = message.channel?.alternatives?.[0]?.transcript;
            if(text) onTranscript({text, isFinal: message.is_final === true});
        });
        conn.on('error', (e) => this.logger.error(`Deepgram error (${opts.room}): ${e.message}`));
        conn.on('close', () => this.logger.warn(`Deepgram stream closed (${opts.room})`));

        conn.connect(); //registers handler and open the socket...
        await conn.waitForOpen(); // ..and this resolves once its actually open 
        this.logger.log(`Deepgram stream open (${opts.room})`);

        return {
            sendAudio: (chuck) => conn.sendMedia(chuck),
            close: async () => conn.close(),
         }
    }

}