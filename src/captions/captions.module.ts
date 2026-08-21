import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionsModule } from '../sessions/sessions.module';
import { CaptionsController } from './captions.controller';
import { CaptionsGateway } from './captions.gateway';
import { CaptionsService } from './captions.service';
import { LivekitService } from './livekit.service';
import { TranscriptSegment } from './entities/transcript-segment.entity';
import { DeepTranscriptionProvider } from './transcription/deepgram.provider';
import { FakeTranscriptionProvider } from './transcription/fake.provider';
import { TRANSCRIPTION_PROVIDER } from './transcription/transcription.interface';

@Module({
  imports: [TypeOrmModule.forFeature([TranscriptSegment]), SessionsModule],
  controllers: [CaptionsController],
  providers: [
    CaptionsService,
    CaptionsGateway,
    LivekitService,
    {
      provide: TRANSCRIPTION_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('DEEPGRAM_API_KEY')
          ? new DeepTranscriptionProvider(config)
          : new FakeTranscriptionProvider(),
    },
  ],
  exports: [CaptionsService, LivekitService],
})
export class CaptionsModule { }
