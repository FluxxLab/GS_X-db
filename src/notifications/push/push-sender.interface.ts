export const PUSH_SENDER = Symbol('PUSH_SENDER');

/**
 * A device registered through POST /notifications/register. `platform` decides
 * the transport: iOS hands back a raw APNs device token, Android an FCM
 * registration token, and the two are not interchangeable.
 */
export interface PushTarget {
  token: string;
  platform: string;
}

export interface PushSender {
  sendToTokens(
    targets: PushTarget[],
    title: string,
    body: string,
  ): Promise<{ invalidTokens: string[] }>;
}
