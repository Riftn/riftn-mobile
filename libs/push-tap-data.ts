import type * as Notifications from 'expo-notifications';

type TapData = { type: string; [key: string]: unknown };

/**
 * The payload a tap carries. Normally `content.data`; if that ever comes back
 * empty (a push the system drew itself while the app was closed), the same
 * object is still on the trigger: the FCM message's `body` string on Android,
 * the APNs payload's `body` on iPhone. A tap with no type is ignored, and the
 * app simply opens on Home.
 */
export function readNotificationData(notification: Notifications.Notification | undefined): TapData | null {
  if (!notification) return null;
  const content = notification.request?.content?.data as any;
  if (content && typeof content.type === 'string') return content as TapData;
  const trigger = notification.request?.trigger as any;
  const candidates = [
    trigger?.remoteMessage?.data?.body,
    trigger?.remoteMessage?.data,
    trigger?.payload?.body,
    trigger?.payload,
  ];
  for (const candidate of candidates) {
    let value = candidate;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { continue; }
    }
    if (value && typeof value === 'object' && typeof value.type === 'string') return value as TapData;
  }
  return null;
}

/** Only a delivered message push for the conversation and account being read. */
export function isReadMessagePush(
  notification: Notifications.Notification,
  conversationId: string,
  address: string,
  readThrough: number,
): boolean {
  // A failed quick reply uses the same tap route, but is a local notification.
  if (notification.request.trigger?.type !== 'push' || notification.date > readThrough) return false;
  const data = readNotificationData(notification);
  if (data?.type !== 'new_message') return false;
  if (typeof data.recipient === 'string' && data.recipient.toLowerCase() !== address.toLowerCase()) return false;
  const id = data.conversationId ?? (typeof data.deepLink === 'string'
    ? data.deepLink.match(/^\/dm\/([^/?#]+)(?:[?#]|$)/)?.[1]
    : undefined);
  return id === conversationId;
}

