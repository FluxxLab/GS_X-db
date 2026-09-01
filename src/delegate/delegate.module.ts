import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Delegate } from './entities/delegate.entity';
import { DelegatesService } from './delegates.service';
import { DelegatesGateway } from './delegates.gateway';
import { StorageService } from '../common/storage/storage.service';
import { RegistrationEntry } from './entities/registration-entry.entity';
import { DelegatesController } from './delegates.controller';
import { DelegateConnection } from './entities/delegate-connection.entity';
import { DirectMessage } from './entities/direct-message.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { DelegateBlock } from './entities/delegate-block.entity';
import { RealtimeModule } from '../common/realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Delegate,
      RegistrationEntry,
      DelegateConnection,
      DirectMessage,
      MessageReaction,
      DelegateBlock,
    ]),
    RealtimeModule,
    // A connection raises a notification for the other delegate. Queued, not
    // called: NotificationsService already depends on this module.
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  controllers: [DelegatesController],
  providers: [DelegatesService, DelegatesGateway, StorageService],
  exports: [DelegatesService],
})
export class DelegateModule {}
