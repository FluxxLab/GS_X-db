import { SessionAttendance } from './entities/attendance.entity';
import { SessionComment } from '../discussions/entities/session-comment.entity';
import { TranscriptSegment } from '../captions/entities/transcript-segment.entity';
import { StorageService } from '../common/storage/storage.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionBookmark } from './entities/bookmark.entity';
import { Session } from './entities/session.entity';
import { Speaker } from './entities/speaker.entity';
import { SessionController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SpeakersController } from './speakers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Session,
      Speaker,
      SessionBookmark,
      SessionAttendance,
      // deleting a session has to clear its comments and transcript too -
      // neither table has a foreign key back to sessions
      SessionComment,
      TranscriptSegment,
    ]),
  ],
  controllers: [SessionController, SpeakersController],
  providers: [SessionsService, StorageService],
  exports: [SessionsService], // search, captions, discussions will need it
})
export class SessionsModule {}
