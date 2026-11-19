/** The /dm server confirms persistence with a sender-only sendMessage echo. */
export interface DmSendTransport {
  senderAddress?: string;
  on(event: string, handler: (data: any) => void): () => void;
  emit(payload: DmSendPayload): void;
}

export interface DmSendPayload {
  dmId: string;
  content?: string;
  type: string;
  gif?: string;
  /** The app's own id for this line; the server echoes it and dedupes resends by it. */
  clientId?: string;
}

export interface DmSendEcho {
  _id: string;
  conversation?: unknown;
  dmId?: string;
  conversationId?: string;
  sender?: string | { address?: string };
  author?: string;
  content?: string;
  msgType?: string;
  mediaUrls?: Array<{ url: string }>;
  clientId?: string;
}

/** Lost confirmation (timeout or socket drop): the line may be resent safely. */
export class DmSendUnconfirmedError extends Error {
  readonly unconfirmed = true;
}

export function isUnconfirmedSend(error: unknown): boolean {
  return !!(error as { unconfirmed?: boolean })?.unconfirmed;
}

/** Subscribe before emitting, and never treat transport delivery as a saved message. */
export function confirmDmSend<T extends DmSendEcho>(
  transport: DmSendTransport,
  payload: DmSendPayload,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const unsubscribers: Array<() => void> = [];
    const finish = (message?: T, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribers.forEach(unsubscribe => unsubscribe());
      if (error) reject(error);
      else resolve(message!);
    };
    const timer = setTimeout(() => finish(undefined, new DmSendUnconfirmedError(
      'The server did not confirm this message. Refresh the conversation before trying again.',
    )), timeoutMs);

    try {
      unsubscribers.push(transport.on('sendMessage', (message: T) => {
        const conversation = message?.conversation;
        const dmId = typeof conversation === 'string'
          ? conversation : (conversation as { _id?: string })?._id || message?.dmId || message?.conversationId;
        if (dmId !== payload.dmId || !message?._id) return;
        if (message.author && message.author !== 'me') return;
        // The server tags the saved line with our own id: that is proof enough.
        if (payload.clientId && message.clientId) {
          if (message.clientId === payload.clientId) finish(message);
          return;
        }
        // Socket echoes can omit the display-only author field. Confirm those
        // by the authenticated sender instead of timing out a saved message.
        const senderAddress = typeof message.sender === 'string' ? message.sender : message.sender?.address;
        if (!message.author && (!transport.senderAddress ||
            senderAddress?.toLowerCase() !== transport.senderAddress.toLowerCase())) return;
        if ((message.msgType || 'msg') !== payload.type) return;
        // Compare the wire content, including encrypted envelopes, before decryption.
        // The server trims what it stores, so compare trimmed.
        if ((message.content || '').trim() !== (payload.content || '').trim()) return;
        if (payload.gif && !message.mediaUrls?.some(media => media.url === payload.gif)) return;
        finish(message);
      }));
      unsubscribers.push(transport.on('error', (error: any) => {
        if (error?.dmId && error.dmId !== payload.dmId) return;
        // Errors from other actions (a read receipt, a reaction) are not about this line.
        if (error?.event && error.event !== 'sendMessage') return;
        if (error?.clientId && payload.clientId && error.clientId !== payload.clientId) return;
        finish(undefined, new Error(error?.msg || error?.message || 'Failed to send message.'));
      }));
      const disconnected = () => finish(undefined, new DmSendUnconfirmedError(
        'Chat disconnected before confirming this message. Refresh the conversation before trying again.',
      ));
      unsubscribers.push(transport.on('disconnect', disconnected));
      unsubscribers.push(transport.on('disconnected', disconnected));
      transport.emit(payload);
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error('Failed to send message.'));
    }
  });
}
