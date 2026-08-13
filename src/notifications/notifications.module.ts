import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DelegateModule } from '../delegate/delegate.module';
import { DeviceToken } from './entities/device-token.entity';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import { FcmPushSender } from './push/fcm-push.sender';
import { LogPushSender } from './push/log-push.sender';
import { PUSH_SENDER } from './push/push-sender.interface';
import { EMAIL_SENDER } from './email/email-sender.interface';
import { LogEmailSender } from './email/log-email.sender';
import { SmtpEmailSender } from './email/smtp-email.sender';
import { SMS_SENDER } from './sms/sms-sender.interface';
import { LogSmsSender } from './sms/log-sms.sender';
import { TermiiSmsSender } from './sms/termii-sms.sender';
import {NotificationsGateway} from './notifications.gateway';
@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, DeviceToken]),
    BullModule.registerQueue({ name: 'notifications' }),   
    DelegateModule,                                        
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    NotificationsGateway,
    {
      provide: PUSH_SENDER,
      inject: [ConfigService],                            
      useFactory: (config: ConfigService) =>
        config.get('FIREBASE_PROJECT_ID') ? new FcmPushSender(config) : new LogPushSender(),
    },
    {
  provide: EMAIL_SENDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    config.get('SMTP_HOST') ? new SmtpEmailSender(config) : new LogEmailSender(),
},
{
  provide: SMS_SENDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    config.get('TERMII_API_KEY') ? new TermiiSmsSender(config) : new LogSmsSender(),
},

  ],
  exports: [EMAIL_SENDER, SMS_SENDER, NotificationsGateway]
})
export class NotificationsModule {}
