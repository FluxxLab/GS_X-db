import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsModule } from '../sessions/sessions.module';
import { CaptionsController } from './captions.controller';
import { CaptionsGateway } from './captions.gateway';
import { CaptionsArchiveProcessor } from './captions-archive.processor';
import { CaptionsGapfillProcessor } from './captions-gapfill.processor';
import { CaptionsService } from './captions.service';
import { LivekitService } from './livekit.service';
import { TranscriptSegment } from './entities/transcript-segment.entity';
import { DeepTranscriptionProvider } from './transcription/deepgram.provider';
import { FakeTranscriptionProvider } from './transcription/fake.provider';
import { TRANSCRIPTION_PROVIDER } from './transcription/transcription.interface';
import { ClaudeTranslationProvider } from './translation/claude.provider';
import { NoopTranslationProvider } from './translation/noop.provider';
import { TRANSLATION_PROVIDER } from './translation/translation.interface';

@Module({
  imports: [
    TypeOrmModule.forFeature([TranscriptSegment]),
    SessionsModule,
    // Re-transcription runs for minutes; it cannot sit on the socket handler.
    BullModule.registerQueue({ name: 'captions-archive' }),
    // Translating a language's missing lines costs a dozen Claude calls; it
    // cannot sit on a delegate's catch-up request.
    BullModule.registerQueue({ name: 'caption-gapfill' }),
  ],
  controllers: [CaptionsController],
  providers: [
    CaptionsService,
    CaptionsGateway,
    CaptionsArchiveProcessor,
    CaptionsGapfillProcessor,
    LivekitService,
    {
      provide: TRANSCRIPTION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('DEEPGRAM_API_KEY')
          ? new DeepTranscriptionProvider(config)
          : new FakeTranscriptionProvider(),
    },
    {
      provide: TRANSLATION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('ANTHROPIC_API_KEY')
          ? new ClaudeTranslationProvider(config)
          : new NoopTranslationProvider(),
    },
  ],
  exports: [CaptionsService, LivekitService],
})
export class CaptionsModule {}
