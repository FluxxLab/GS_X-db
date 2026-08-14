import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { EmailSender } from './email-sender.interface';

@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: config.getOrThrow<number>('SMTP_PORT'),
      auth: {
        user: config.getOrThrow<string>('SMTP_USER'),
        pass: config.getOrThrow<string>('SMTP_PASSWORD'),
      },
    });
    this.from = config.getOrThrow<string>('SMTP_FROM');
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text,
    });
  }
}
