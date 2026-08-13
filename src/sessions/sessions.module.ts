import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionBookmark } from './entities/bookmark.entity';
import { Session } from './entities/session.entity';
import { Speaker } from './entities/speaker.entity';
import { SessionController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Session, Speaker, SessionBookmark])],
  controllers: [SessionController],
  providers: [SessionsService],
  exports: [SessionsService], // search, captions, discussions will need it
})
export class SessionsModule {}
