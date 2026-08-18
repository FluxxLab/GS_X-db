import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageService } from '../common/storage/storage.service';
import { DelegateModule } from '../delegate/delegate.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AppDocument } from './entities/app-document.entity';
import { Certificate } from './entities/certificate.entity';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppDocument, Certificate]),
    DelegateModule,
    SessionsModule,
  ],
  controllers: [ResourcesController],
  providers: [ResourcesService, StorageService],
})
export class ResourcesModule {}
