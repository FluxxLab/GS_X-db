export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}
