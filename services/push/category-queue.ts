/**
 * Notification categories, written one at a time.
 *
 * iOS keeps every category in a single list: setting one reads the list, swaps
 * that entry and writes the whole list back. Several sets started together all
 * read the same old list, so the last write wins and the others are lost. That
 * is how a phone set to Turkish kept "New message on Riftn" on its lock
 * screen: the Turkish line was written, then overwritten by a neighbour that
 * still held the English one. Queued, each set sees the one before it.
 */
import * as Notifications from 'expo-notifications';

let chain: Promise<unknown> = Promise.resolve();

export function setCategoryInTurn(
  ...args: Parameters<typeof Notifications.setNotificationCategoryAsync>
): Promise<unknown> {
  const next = chain.then(() => Notifications.setNotificationCategoryAsync(...args));
  chain = next.catch(() => undefined);
  return next;
}
