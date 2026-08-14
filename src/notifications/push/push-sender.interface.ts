export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushSender {
  sendToTokens(
    tokens: string[],
    title: string,
    body: string,
  ): Promise<{ invalidTokens: string[] }>;
}
