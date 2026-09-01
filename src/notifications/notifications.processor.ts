import { In, Repository } from 'typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RealtimeService, Rooms } from 'src/common/realtime/realtime.service';
import { DelegatesService } from 'src/delegate/delegates.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { DeviceToken } from './entities/device-token.entity';
import { PUSH_SENDER } from './push/push-sender.interface';
import type { PushSender } from './push/push-sender.interface';

export interface DirectJob {
  delegateId: string;
  title: string;
  body: string;
  category: string | null;
}

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

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

  /**
   * Two job shapes on one queue.
   *
   * 'dispatch' is the segment broadcast an organiser composes. 'direct' is a
   * notification with a single recipient, raised by another module - a
   * connection, for instance. It arrives as a queued job rather than a service
   * call because notifications already depends on delegates, and calling back
   * the other way would make that a cycle for the sake of one message.
   */
  async process(
    job: Job<{ notificationId: string } | DirectJob>,
  ): Promise<void> {
    if (job.name === 'direct') {
      await this.sendDirect(job.data as DirectJob);
      return;
    }

    const { notificationId } = job.data as { notificationId: string };
    const notification = await this.notifications.findOneBy({
      id: notificationId,
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

    /**
     * Delivering to nobody is otherwise indistinguishable from success: the
     * row still gets stamped sent, the admin sees a green tick, and no device
     * ever rings. A segment with delegates but no registered tokens means the
     * app never called POST /notifications/register - Expo Go, the Settings
     * push toggle, or a denied permission.
     */
    if (delegateIds.length > 0 && tokens.length === 0) {
      this.logger.warn(
        `"${notification.title}" reached 0 devices: ${delegateIds.length} delegate(s) in segment "${notification.segment}", none with a registered push token`,
      );
    } else {
      this.logger.log(
        `"${notification.title}" -> ${tokens.length} device(s) in segment "${notification.segment}"`,
      );
    }

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

  /**
   * One recipient: persisted so it appears in their inbox, pushed to their
   * devices, and emitted on their personal room so the app marks it unread
   * while they are looking at another screen.
   */
  private async sendDirect(data: DirectJob): Promise<void> {
    const notification = await this.notifications.save(
      this.notifications.create({
        title: data.title,
        body: data.body,
        category: data.category,
        delegateId: data.delegateId,
        // stamped here rather than after the push: the row is the delegate's
        // copy, and it should survive in their inbox even if no device of
        // theirs is registered to receive it
        sentAt: new Date(),
      }),
    );

    const tokens = (
      await this.deviceTokens.findBy({ delegateId: data.delegateId })
    ).map((t) => t.token);

    if (tokens.length === 0) {
      // Expected in Expo Go and for anyone who declined the permission - the
      // inbox entry above is still there when they next open the app.
      this.logger.log(
        `direct "${data.title}" -> no registered device for ${data.delegateId}`,
      );
    } else {
      const { invalidTokens } = await this.push.sendToTokens(
        tokens,
        data.title,
        data.body,
      );
      if (invalidTokens.length)
        await this.deviceTokens.delete({ token: In(invalidTokens) });
    }

    this.realtime.emitToRoom(Rooms.network(data.delegateId), 'notification', {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      category: notification.category,
      segment: notification.segment,
    });
  }
}
