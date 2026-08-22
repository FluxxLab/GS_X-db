import { BullModule } from '@nestjs/bullmq';
import { Logger, Module } from '@nestjs/common';
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
import { ZeptoEmailSender } from './email/zepto-email.sender';
import { SMS_SENDER } from './sms/sms-sender.interface';
import { LogSmsSender } from './sms/log-sms.sender';
import { TermiiSmsSender } from './sms/termii-sms.sender';
import { NotificationsGateway } from './notifications.gateway';

const logger = new Logger('NotificationsModule');

/**
 * ZeptoMail needs a token and a verified sender address. Warns rather than
 * failing quietly when the token is set but the address is not: a half
 * configured provider that silently falls back to logging is how OTP emails
 * stop arriving without anyone noticing.
 */
function hasZeptoMail(config: ConfigService): boolean {
  const token = config.get('ZEPTOMAIL_TOKEN');
  if (!token) return false;

  if (!config.get('ZEPTOMAIL_FROM_ADDRESS')) {
    logger.warn(
      'ZEPTOMAIL_TOKEN set but ZEPTOMAIL_FROM_ADDRESS is missing. Falling back.',
    );
    return false;
  }
  return true;
}

function hasAllSmtp(config: ConfigService): boolean {
  const required = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM',
  ] as const;
  const missing = required.filter((k) => !config.get(k));
  if (missing.length > 0) {
    if (config.get('SMTP_HOST')) {
      logger.warn(
        `SMTP_HOST set but missing: ${missing.join(', ')}. Falling back to LogEmailSender.`,
      );
    }
    return false;
  }
  return true;
}

function hasAllTermii(config: ConfigService): boolean {
  const required = ['TERMII_API_KEY', 'TERMII_SENDER_ID'] as const;
  const missing = required.filter((k) => !config.get(k));
  if (missing.length > 0) {
    if (config.get('TERMII_API_KEY')) {
      logger.warn(
        `TERMII_API_KEY set but missing: ${missing.join(', ')}. Falling back to LogSmsSender.`,
      );
    }
    return false;
  }
  return true;
}

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
        config.get('FIREBASE_PROJECT_ID')
          ? new FcmPushSender(config)
          : new LogPushSender(),
    },
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        // ZeptoMail first, SMTP as the fallback for anyone still on it, and
        // LogEmailSender last so local development needs no credentials.
        hasZeptoMail(config)
          ? new ZeptoEmailSender(config)
          : hasAllSmtp(config)
            ? new SmtpEmailSender(config)
            : new LogEmailSender(),
    },
    {
      provide: SMS_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        hasAllTermii(config) ? new TermiiSmsSender(config) : new LogSmsSender(),
    },
  ],
  exports: [EMAIL_SENDER, SMS_SENDER, NotificationsGateway],
})
export class NotificationsModule {}
