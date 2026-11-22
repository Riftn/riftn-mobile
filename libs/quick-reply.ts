/**
 * Replying to a message without opening the chat: from the Reply box on the
 * phone's own notification, or from the in-app message banner.
 *
 * Sent over HTTP (POST /dm/quick-reply), not the chat socket: a reply typed
 * into a notification can wake the app in the background, where no socket is
 * open. The server runs the same checks as any message and pushes the line to
 * every open chat screen, the sender's own included.
 *
 * An encrypted chat gets the sealed envelope, exactly like a line sent by hand.
 * When the keys are not at hand the reply is refused rather than sent in the
 * clear, and the caller opens the chat instead.
 */
import { apiClient } from './api.client';
import { getAuthUser } from './auth.utils';
import { getConversation } from '../services/dm/dm.api';
import { encryptForPeer } from './dm-e2ee/keys';
import { chatWantsEncryption } from './dm-e2ee/encrypt-choice';

export type QuickReplyResult = { dmId: string; status: 'sent' | 'queued'; messageId?: string };

/** The reply cannot go from here (group, encrypted chat locked, another account): open the chat. */
export class QuickReplyNeedsChatError extends Error {
  readonly needsChat = true;
}

export function needsChat(error: unknown): boolean {
  return !!(error as { needsChat?: boolean })?.needsChat;
}

const lower = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '');

export async function sendQuickReply(input: {
  conversationId: string;
  text: string;
  /** Address the push was sent to; a reply never goes out from a different account. */
  recipient?: string | null;
}): Promise<QuickReplyResult> {
  const text = (input.text || '').trim();
  if (!text || !input.conversationId) throw new Error('Write a message first.');

  const user = await getAuthUser<{ address?: string; walletAddress?: string }>();
  const me = lower(user?.address) || lower(user?.walletAddress);
  if (!me) throw new QuickReplyNeedsChatError('Not signed in');
  if (input.recipient && lower(input.recipient) !== me) throw new QuickReplyNeedsChatError('Another account');

  const conversation = await getConversation(input.conversationId);
  const peer = conversation.participants
    .map((p: any) => lower(p?.participant?.address))
    .find((address) => address && address !== me);
  if (!peer) throw new QuickReplyNeedsChatError('No one to reply to');

  let content = text;
  if (await chatWantsEncryption(input.conversationId, peer)) {
    const sealed = await encryptForPeer(peer, text);
    if (!sealed) throw new QuickReplyNeedsChatError('Encrypted chat');
    content = sealed;
  }

  const res = await apiClient.post<{ result: QuickReplyResult }>(
    '/dm/quick-reply',
    { dmId: input.conversationId, content },
    { isAuthRequired: true },
  );
  return res?.result ?? { dmId: input.conversationId, status: 'sent' };
}
