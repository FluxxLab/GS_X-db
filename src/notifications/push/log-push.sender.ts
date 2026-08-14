import { Injectable, Logger } from '@nestjs/common';
import { PushSender } from './push-sender.interface';

@Injectable()
export class LogPushSender implements PushSender {
  private readonly logger = new Logger('LogPushSender');

  async sendToTokens(tokens: string[], title: string, body: string) {
    this.logger.log(
      `[dev] would push "${title}" — "${body}" to ${tokens.length} device(s)`,
    );
    return { invalidTokens: [] };
  }
}
