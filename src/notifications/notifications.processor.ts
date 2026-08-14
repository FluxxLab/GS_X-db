import { In, Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { RealtimeService, Rooms } from 'src/common/realtime/realtime.service';
import { DelegatesService } from 'src/delegate/delegates.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { DeviceToken } from './entities/device-token.entity';
import { PUSH_SENDER } from './push/push-sender.interface';
import type { PushSender } from './push/push-sender.interface';

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly delegate: DelegatesService,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @Inject(PUSH_SENDER)
    private readonly push: PushSender,
    @InjectRepository(DeviceToken)
    private readonly deviceTokens: Repository<DeviceToken>,
  ) {
    super();
  }

  async process(job: Job<{ notificationId: string }>): Promise<void> {
    const notification = await this.notifications.findOneBy({
      id: job.data.notificationId,
    });

    /**
     * Indempotent operation: if notification is already sent, do nothing
     */
    if (!notification || notification.sentAt) return;

    /**
     * Owner exposese this
     */
    const delegateIds = await this.delegate.idsForSegment(notification.segment);

    const tokens = delegateIds.length
      ? (await this.deviceTokens.findBy({ delegateId: In(delegateIds) })).map(
          (t) => t.token,
        )
      : [];

    const { invalidTokens } = await this.push.sendToTokens(
      tokens,
      notification.title,
      notification.body,
    );
    if (invalidTokens.length)
      await this.deviceTokens.delete({ token: In(invalidTokens) });

    await this.notifications.update(notification.id, { sentAt: new Date() });
    this.realtime.emitToRoom(
      Rooms.notifications(notification.segment),
      'notification',
      {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        category: notification.category,
        segment: notification.segment,
      },
    );
  }
}
