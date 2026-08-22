import { Module } from '@nestjs/common';
import { DiscussionsGateway } from './discussions.gateway';
import { DiscussionService } from './discussions.service';
import { DiscussionsController } from './discussions.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionComment } from './entities/session-comment.entity';
import { CommentVote } from './entities/comment-vote.entity';

import { RealtimeService } from '../common/realtime/realtime.service';
import { SessionsModule } from 'src/sessions/sessions.module';
import { DelegateModule } from 'src/delegate/delegate.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SessionComment, CommentVote]),
    SessionsModule,
    DelegateModule,
  ],
  providers: [DiscussionsGateway, DiscussionService, RealtimeService],
  controllers: [DiscussionsController],
})
export class DiscussionsModule {}
