import { Module } from '@nestjs/common';
import { DelegateModule } from '../delegate/delegate.module';
import { SessionsModule } from '../sessions/sessions.module';
import { VotingModule } from '../voting/voting.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [DelegateModule, SessionsModule, VotingModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
