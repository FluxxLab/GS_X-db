import {Injectable} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { DeviceToken } from './entities/device-token.entity';
import { InjectQueue } from '@nestjs/bullmq';
import { RealtimeService } from '../common/realtime/realtime.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification } from './entities/notification.entity';
import { Queue } from 'bullmq';
import { AudienceSegment } from './entities/notification.entity';
import { AccessTier } from 'src/delegate/entities/delegate.entity';
import { In } from 'typeorm/browser';

@Injectable()
export class NotificationsService{
    constructor(
        @InjectRepository(Notification)
        private readonly notifications: Repository<Notification>,
        @InjectRepository(DeviceToken)
        private readonly deviceTokens: Repository<DeviceToken>,
        @InjectQueue('notifications')
        private readonly queue: Queue,
        private readonly realtime: RealtimeService
    ){}

    async announce(dto: CreateNotificationDto): Promise<Notification> {
        const notification = await this.notifications.save(this.notifications.create(dto));

        await this.queue.add('dispatch', { notificationId: notification.id })
        
        /**
         * Admin gets a 201 in milliseconds;
         * sending happens in the worker
         */
        return notification;
    }


    async registerDevice(delegateId: string, token: string, platform: string):Promise<void>{
        await this.deviceTokens
            .createQueryBuilder()
            .insert()
            .values({delegateId, token, platform})
            .orUpdate(['delegateId', 'platform'], ['token'])
            .execute()

    }


    inboxFor(user: {id: string; role: AccessTier}): Promise<Notification[]> {
        const segments = [AudienceSegment.ALL];

        if(user.role === AccessTier.VIP || user.role === AccessTier.ADMIN) segments.push(AudienceSegment.VIP);
        if(user.role === AccessTier.PRESS) segments.push(AudienceSegment.PRESS);

        /**
         * Speakers/volunteers segments resolves via tags in the processor;
         * inbox parity needs a join 
         * TODO: implement with delegate tags
         */
        return this.notifications.find({
            where: {segment: In(segments), sentAt: Not(IsNull())},
            order: {sentAt: 'DESC'},
            take: 50,
        });
    }
}
