import { Module } from '@nestjs/common';
import { DiscussionsGateway } from './discussions.gateway';
import { DiscussionService } from './discussions.service';
import { DiscussionsController } from './discussions.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionComment } from './entities/session-comment.entity';

import { RealtimeService } from '../common/realtime/realtime.service';
import { SessionsModule } from 'src/sessions/sessions.module';
import { DelegateModule } from 'src/delegate/delegate.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SessionComment]),
    SessionsModule,
    DelegateModule,
  ],
  providers: [DiscussionsGateway, DiscussionService, RealtimeService],
  controllers: [DiscussionsController],
})
export class DiscussionsModule {}
