import { Module } from '@nestjs/common';
import { DelegateModule } from '../delegate/delegate.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [SessionsModule, DelegateModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
