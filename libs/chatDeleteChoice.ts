/**
 * Saved answer to "Delete message?" in chats. Same values and key as web
 * (src/lib/chat-delete-choice.ts), kept on this device (hooks/useAppPrefs).
 * "ask" shows the sheet every time; "me" deletes from your chat straight
 * away; "everyone" deletes for everyone whenever that is allowed and falls
 * back to "for me" when it isn't (someone else's message in a group).
 */
export const CHAT_DELETE_CHOICES = ['ask', 'me', 'everyone'] as const;
export type ChatDeleteChoice = (typeof CHAT_DELETE_CHOICES)[number];

export function isChatDeleteChoice(value: unknown): value is ChatDeleteChoice {
  return typeof value === 'string' && (CHAT_DELETE_CHOICES as readonly string[]).includes(value);
}
