type NotificationReadState = { read?: boolean };

export function extractNotificationItems(response: unknown): NotificationReadState[] {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];

  const envelope = response as {
    result?: unknown;
    data?: { result?: unknown };
  };
  const result = envelope.data?.result ?? envelope.result;

  return Array.isArray(result) ? result : [];
}

export function countUnreadNotifications(response: unknown): number {
  return extractNotificationItems(response).filter((notification) => notification?.read !== true).length;
}

export function incrementUnreadCount(current: number | undefined): number {
  return Math.max(0, Number.isFinite(current) ? current ?? 0 : 0) + 1;
}

type TappedPush = {
  type?: unknown;
  tokenId?: unknown;
  commentId?: unknown;
  actorAddress?: unknown;
  streamId?: unknown;
  conversationId?: unknown;
};

const same = (a: unknown, b: unknown) =>
  a != null && b != null && a !== '' && b !== '' && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Rows in the bell that a tapped push stands for: same type, and every id the
 * push carries (post, comment, sender, stream, chat) matches the row. A push
 * with no id at all matches nothing, so a tap never clears unrelated rows.
 */
export function notificationsMatchingTap<T extends { _id?: unknown; id?: unknown; read?: boolean }>(
  rows: T[],
  push: TappedPush,
): T[] {
  if (!push?.type) return [];
  const keys = ['tokenId', 'commentId', 'actorAddress', 'streamId', 'conversationId'] as const;
  const carried = keys.filter((k) => push[k] != null && push[k] !== '');
  if (!carried.length) return [];
  return rows.filter((row) => {
    if (row?.read === true) return false;
    const r = row as Record<string, unknown>;
    if (!same(r.type, push.type)) return false;
    return carried.every((k) => r[k] == null || same(r[k], push[k]))
      && carried.some((k) => same(r[k], push[k]));
  });
}
