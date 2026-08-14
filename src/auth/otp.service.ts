import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from '../common/redis/redis.module';
import { EMAIL_SENDER } from '../notifications/email/email-sender.interface';
import type { EmailSender } from '../notifications/email/email-sender.interface';
import { SMS_SENDER } from '../notifications/sms/sms-sender.interface';
import type { SmsSender } from '../notifications/sms/sms-sender.interface';

export type OtpChannel = 'email' | 'sms';

const OTP_TTL_SEC = 600;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 3;

@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS)
    private readonly redis: Redis,
    @Inject(EMAIL_SENDER)
    private readonly email: EmailSender,
    @Inject(SMS_SENDER)
    private readonly sms: SmsSender,
  ) {}

  async requestOtp(
    rawEmail: string,
    channel: OtpChannel,
    phone?: string,
  ): Promise<void> {
    const email = rawEmail.toLowerCase().trim();
    if (channel === 'sms' && !phone) {
      throw new BadRequestException(
        'Phone number is required for Sms verification',
      );
    }

    const requests = await this.redis.incr(`otp:rate:${email}`);
    if (requests === 1) {
      await this.redis.expire(`otp:rate:${email}`, 3600);
    }
    if (requests > MAX_REQUESTS_PER_HOUR) {
      throw new HttpException(
        'Too many requests - try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(100000, 1000000).toString();
    await this.redis.set(
      `otp:code:${email}`,
      JSON.stringify({ code, channel }),
      'EX',
      OTP_TTL_SEC,
    );
    await this.redis.del(`otp:attempts:${email}`);

    const text = `Your GS-26 registration code is ${code}. it expires in 10 minutes`;

    if (channel === 'sms') {
      await this.sms.send(phone as string, text);
    } else {
      await this.email.send(email, 'Your GS-26 verification code', text);
    }
  }

  /**
   * Returns the cannel that was verified; throws otherwise. consumes
   */
  async assertValid(rawEmail: string, code: string): Promise<OtpChannel> {
    const email = rawEmail.toLowerCase().trim();

    const attempts = await this.redis.incr(`otp:attemps:${email}`);
    if (attempts > MAX_ATTEMPTS) {
      await this.redis.del(`otp:code:${email}`);
      throw new HttpException(
        'Too many attempts - try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const stored = await this.redis.get(`otp:code:${email}`);
    if (!stored) {
      throw new BadRequestException('Invalid or expired code');
    }

    const parsed = JSON.parse(stored) as { code: string; channel: OtpChannel };
    if (parsed.code !== code) {
      throw new BadRequestException('invalid or expired code');
    }

    await this.redis.del(`otp:code:${email}`, `otp:attempts:${email}`);

    return parsed.channel;
  }
}
