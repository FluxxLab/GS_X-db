import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { DeviceToken } from './entities/device-token.entity';
import { InjectQueue } from '@nestjs/bullmq';
import { RealtimeService } from '../common/realtime/realtime.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification } from './entities/notification.entity';
import { Queue } from 'bullmq';
import { AudienceSegment } from './entities/notification.entity';
import { DelegatesService } from 'src/delegate/delegates.service';
import { AccessTier } from 'src/delegate/entities/delegate.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(DeviceToken)
    private readonly deviceTokens: Repository<DeviceToken>,
    @InjectQueue('notifications')
    private readonly queue: Queue,
    private readonly realtime: RealtimeService,
    private readonly delegates: DelegatesService,
  ) {}

  async announce(dto: CreateNotificationDto): Promise<Notification> {
    const notification = await this.notifications.save(
      this.notifications.create(dto),
    );

    await this.queue.add('dispatch', { notificationId: notification.id });

    /**
     * Admin gets a 201 in milliseconds;
     * sending happens in the worker
     */
    return notification;
  }

  async registerDevice(
    delegateId: string,
    token: string,
    platform: string,
  ): Promise<void> {
    await this.deviceTokens
      .createQueryBuilder()
      .insert()
      .values({ delegateId, token, platform })
      .orUpdate(['delegateId', 'platform'], ['token'])
      .execute();
  }

  // Drop a device so it stops receiving push. Scoped to the caller: a token can
  // only be removed by the delegate it is currently registered to, so knowing
  // someone else's token is not enough to silence their phone.
  async unregisterDevice(delegateId: string, token: string): Promise<void> {
    await this.deviceTokens.delete({ delegateId, token });
  }

  /**
   * The segments a delegate can read back must be the segments they were sent,
   * or an announcement arrives as a push and then cannot be found in the app.
   * Membership is resolved by the same code that picks push recipients rather
   * than a second, hand-maintained list.
   */
  async inboxFor(user: {
    id: string;
    role: AccessTier;
  }): Promise<Notification[]> {
    const segments =
      user.role === AccessTier.ADMIN
        ? // Organisers need to see everything that went out, from any device.
          Object.values(AudienceSegment)
        : await this.delegates.segmentsFor(user.id);

    return this.notifications.find({
      where: [
        // broadcasts for the segments this delegate belongs to
        { segment: In(segments), sentAt: Not(IsNull()), delegateId: IsNull() },
        // and anything addressed to them personally, whatever its segment
        { delegateId: user.id, sentAt: Not(IsNull()) },
      ],
      order: { sentAt: 'DESC' },
      take: 50,
    });
  }

  /**
   * Admin retraction. The row goes, so it leaves every inbox on the next
   * fetch, and the broadcast removes it from inboxes that are open right now.
   * Push notifications already delivered to phones cannot be recalled.
   */
  async remove(id: string): Promise<void> {
    const existing = await this.notifications.findOneBy({ id });
    if (!existing) throw new NotFoundException('Notification not found');
    await this.notifications.delete({ id });
    this.realtime.emitGlobal('notification:deleted', { id });
  }
}
