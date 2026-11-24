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
import i18n from 'i18next';

let chain: Promise<unknown> = Promise.resolve();

export function setCategoryInTurn(
  ...args: Parameters<typeof Notifications.setNotificationCategoryAsync>
): Promise<unknown> {
  const next = chain.then(() => Notifications.setNotificationCategoryAsync(...args));
  chain = next.catch(() => undefined);
  return next;
}

/**
 * The app boots in English and switches once the saved language has loaded.
 * Lines written before that are English for everyone, so wait for it (but not
 * forever: a language that cannot load leaves the app in English anyway).
 */
export function categoryLanguageSettled(): Promise<void> {
  let ready: Promise<void> = Promise.resolve();
  try {
    // Loaded here, not at the top: the language service pulls in native
    // storage, which this small file should not force on everything that
    // imports the push service.
    ready = (require('../../i18n') as { languageReady: Promise<void> }).languageReady;
  } catch { /* no language service: write with what is loaded */ }
  return Promise.race([ready, new Promise<void>(resolve => setTimeout(resolve, 12000))]);
}

/**
 * Runs `again` when more of the current language arrives. Languages outside
 * the bundled few load their texts in parts, on first use, so the first write
 * can still be English; the next part brings the real line.
 */
export function onLanguageTextArrived(again: () => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; again(); }, 800);
  };
  i18n.on?.('languageChanged', schedule);
  i18n.store?.on?.('added', (lng: string) => { if (lng === i18n.language && lng !== 'en') schedule(); });
}
