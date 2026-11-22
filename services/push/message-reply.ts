/**
 * The Reply box on a message notification.
 *
 * The server sends one-to-one message pushes under the 'message_reply'
 * category; this file registers that category with a text field, so the
 * phone's own notification (lock screen, shade, banner) gets a Reply button.
 * expo-notifications already carries categories and text actions in the
 * installed builds, so this arrives with an app update, no store build.
 *
 * iPhone: the reply is sent in the background and the app stays closed. The
 * phone asks to be unlocked first, so a locked phone cannot reply as you.
 * Android: the reply opens the app on the chat while it sends, because a
 * closed Android app cannot run the send in the background.
 *
 * Anything that cannot go from here (a group, an encrypted chat whose keys are
 * not loaded, a push for another saved account) leaves a "not sent, tap to
 * open the chat" notification instead of losing the words.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import i18n from 'i18next';
import { translateCopy } from '../../i18n/copy';
import { storage } from '../../libs/storage';
import { createLogger } from '../../libs/logger';
import { readNotificationData } from '../../libs/push-tap-data';

const logger = createLogger('MessageReply');

export const MESSAGE_REPLY_CATEGORY = 'message_reply';
export const MESSAGE_REPLY_ACTION = 'reply';

const HANDLED_KEY = 'push.quickReplyHandled';

/** True for a response that came from the Reply box rather than a tap. */
export function isReplyAction(response: Notifications.NotificationResponse | null | undefined): boolean {
  return response?.actionIdentifier === MESSAGE_REPLY_ACTION;
}

let registeredLanguage: string | null = null;

export async function registerMessageReplyCategory(): Promise<void> {
  const language = i18n.language || 'en';
  if (registeredLanguage === language) return;
  registeredLanguage = language;
  try {
    await Notifications.setNotificationCategoryAsync(
      MESSAGE_REPLY_CATEGORY,
      [
        {
          identifier: MESSAGE_REPLY_ACTION,
          buttonTitle: translateCopy('quickReply.reply', { defaultValue: 'Reply' }),
          textInput: {
            submitButtonTitle: translateCopy('quickReply.send', { defaultValue: 'Send' }),
            placeholder: translateCopy('quickReply.placeholder', { defaultValue: 'Write a reply…' }),
          },
          options: {
            opensAppToForeground: Platform.OS === 'android',
            isAuthenticationRequired: true,
          },
        },
      ],
      { previewPlaceholder: translateCopy('quickReply.hiddenPreview', { defaultValue: 'New message on Riftn' }) },
    );
  } catch (error) {
    registeredLanguage = null;
    logger.warn('Could not register the message reply category', error as any);
  }
}

i18n.on?.('languageChanged', () => { void registerMessageReplyCategory(); });

/** Each reply is sent once, even when the same response is replayed on launch. */
function claim(id: string): boolean {
  const seen = (storage.getString(HANDLED_KEY) || '').split('\n').filter(Boolean);
  if (seen.includes(id)) return false;
  storage.set(HANDLED_KEY, [...seen.slice(-19), id].join('\n'));
  return true;
}

async function tellNotSent(conversationId: string, words: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: translateCopy('quickReply.failedTitle', { defaultValue: "Your reply wasn't sent" }),
        body: `${translateCopy('quickReply.failedBody', { defaultValue: 'Tap to open the chat and send it there.' })}\n“${words.slice(0, 120)}”`,
        data: { type: 'new_message', category: 'messages', conversationId, deepLink: `/dm/${conversationId}` },
        sound: 'default',
      },
      trigger: null,
    });
  } catch { /* nothing more to do */ }
}

/** Sends the words typed into a notification's Reply box. Returns true when it was a reply. */
export async function handleReplyResponse(response: Notifications.NotificationResponse | null | undefined): Promise<boolean> {
  if (!response || !isReplyAction(response)) return false;
  const notification = response.notification;
  const id = notification?.request?.identifier;
  const words = (response.userText || '').trim();
  const data = readNotificationData(notification) as Record<string, any> | null;
  const conversationId = typeof data?.conversationId === 'string'
    ? data.conversationId
    : typeof data?.deepLink === 'string' ? data.deepLink.match(/\/dm\/([^/?#]+)/)?.[1] : undefined;
  if (!id || !words || !conversationId) return true;
  if (!claim(id)) return true;

  try {
    // Loaded on first use: keeps the chat and key code off the launch path.
    const { sendQuickReply } = require('../../libs/quick-reply') as typeof import('../../libs/quick-reply');
    await sendQuickReply({ conversationId, text: words, recipient: data?.recipient });
    void Notifications.dismissNotificationAsync(id).catch(() => undefined);
  } catch (error) {
    logger.warn('Reply from notification not sent', error as any);
    void Notifications.dismissNotificationAsync(id).catch(() => undefined);
    await tellNotSent(conversationId, words);
  }
  return true;
}

// Listen as soon as this file loads, before any screen exists: an iPhone wakes
// the app in the background for a reply and the screens never mount.
let listening = false;
export function listenForReplies(): void {
  if (listening) return;
  listening = true;
  try {
    Notifications.addNotificationResponseReceivedListener((response) => {
      if (isReplyAction(response)) void handleReplyResponse(response);
    });
    // A reply that woke the app arrived before the listener existed.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => (isReplyAction(response) ? handleReplyResponse(response) : false))
      .catch(() => undefined);
  } catch (error) {
    logger.warn('Could not listen for notification replies', error as any);
  }
}
