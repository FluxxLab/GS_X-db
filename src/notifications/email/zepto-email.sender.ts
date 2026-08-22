import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendMailClient } from 'zeptomail';
import type { EmailSender } from './email-sender.interface';

/**
 * ZeptoMail over its HTTP API rather than SMTP.
 *
 * Chosen over the SMTP transport because outbound port 587 is the first thing
 * a host blocks, and a transactional API gives per-message delivery errors
 * instead of a socket timeout. The OTP path is the only caller, so a message
 * that silently fails to send is a delegate who cannot register.
 */
@Injectable()
export class ZeptoEmailSender implements EmailSender {
  private readonly logger = new Logger(ZeptoEmailSender.name);
  private readonly client: SendMailClient;
  private readonly from: { address: string; name: string };

  constructor(config: ConfigService) {
    this.client = new SendMailClient({
      // Default matches ZeptoMail's documented endpoint; overridable for the
      // EU/IN data-centre hostnames.
      url:
        config.get<string>('ZEPTOMAIL_URL') ??
        'https://api.zeptomail.com/v1.1/email',
      token: config.getOrThrow<string>('ZEPTOMAIL_TOKEN'),
    });
    this.from = {
      // Must be an address on a domain verified in ZeptoMail, or every send
      // is rejected regardless of the token.
      address: config.getOrThrow<string>('ZEPTOMAIL_FROM_ADDRESS'),
      name: config.get<string>('ZEPTOMAIL_FROM_NAME') ?? 'GS-26 Summit',
    };
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    try {
      await this.client.sendMail({
        from: this.from,
        to: [{ email_address: { address: to, name: to } }],
        subject,
        /**
         * textbody, not htmlbody: every caller is an OTP or a short
         * transactional notice, and plain text cannot carry an injection from
         * whatever built the message.
         */
        textbody: text,
      });
    } catch (err) {
      // The message is logged, never the token or the body.
      this.logger.error(`ZeptoMail send failed to ${to}: ${String(err)}`);
      throw new Error('Email delivery failed');
    }
  }
}
