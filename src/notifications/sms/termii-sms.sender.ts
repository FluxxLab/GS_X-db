import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SmsSender } from './sms-sender.interface';

@Injectable()
export class TermiiSmsSender implements SmsSender {
  private readonly logger = new Logger(TermiiSmsSender.name);

  constructor(private readonly config: ConfigService) {}

  async send(toPhone: string, text: string): Promise<void> {
    try {
      const res = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.config.getOrThrow('TERMII_API_KEY'),
          to: toPhone,
          from: this.config.getOrThrow('TERMII_SENDER_ID'),
          sms: text,
          type: 'plain',
          channel: 'generic',
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`Termii send failed (${res.status}): ${body}`);
        throw new Error(`SMS delivery failed: Termii HTTP ${res.status}`);
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.startsWith('SMS delivery failed')
      ) {
        throw err;
      }
      this.logger.error(`Termii network/unknown error: ${err}`);
      throw new Error('SMS delivery failed: network error');
    }
  }
}
