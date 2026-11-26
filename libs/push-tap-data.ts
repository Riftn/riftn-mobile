import type * as Notifications from 'expo-notifications';

type TapData = { type: string; [key: string]: unknown };

/**
 * The payload a tap carries. Normally `content.data`; if that ever comes back
 * empty (a push the system drew itself while the app was closed), the same
 * object is still on the trigger: the FCM message's `body` string on Android,
 * the APNs payload's `body` on iPhone. Android's presented-notification API
 * can also return the OS extras as `content.data`, with the payload in `body`.
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
    content?.body,
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

