/**
 * Which DMs are encrypted. Off unless someone turns it on.
 *
 * Encrypting every DM by default meant anyone reading a reply on a device
 * without their key had to unlock their wallet first, which for most people
 * is a password they set once and forgot. Now a chat is encrypted only when
 * "Encrypt chat" is on in its menu. The setting is the sender's own, saved
 * with their other chat settings (same store as the website) so it follows
 * them between devices.
 */
import { apiClient } from "../api.client";
import { dmState } from "../../store/dm.store";

type PrefRow = { conversationId: string; encryptedAt?: string | null };

let encrypted: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;

/** Fed from the chat settings query whenever it changes. */
export function setEncryptedChats(prefs: PrefRow[] | undefined | null): void {
  encrypted = new Set((prefs ?? []).filter((p) => !!p.encryptedAt).map((p) => p.conversationId));
}

/** Sign-out: forget the last person's choices. */
export function clearEncryptedChats(): void {
  encrypted = null;
  loading = null;
}

async function load(): Promise<Set<string>> {
  if (encrypted) return encrypted;
  loading ??= apiClient
    .get(`/dm/chat-prefs`, { isAuthRequired: true } as any)
    .then((res: any) => {
      const rows = res?.result ?? res?.data?.result;
      setEncryptedChats(Array.isArray(rows) ? rows : []);
      return encrypted!;
    })
    .catch(() => { loading = null; return new Set<string>(); });
  return loading;
}

/** Everyone in a DM: me and the peer, from the contact row or its messages. */
function membersOf(conversationId: string): string[] {
  const contact: any = dmState.contactsById[conversationId];
  const out: string[] = [];
  for (const p of contact?.participants || []) {
    const a = String(p?.participant?.address || "").toLowerCase();
    if (a) out.push(a);
  }
  for (const m of contact?.messages || []) {
    const a = String(m?.sender?.address || "").toLowerCase();
    if (a) out.push(a);
  }
  return out;
}

/** True when the chat with this person has "Encrypt chat" on. */
export async function wantsEncryptionTo(peerAddress: string | null | undefined): Promise<boolean> {
  if (!peerAddress) return false;
  const ids = await load();
  if (!ids.size) return false;
  const peer = peerAddress.toLowerCase();
  for (const id of ids) {
    if (id.toLowerCase() === peer) return true;
    if (membersOf(id).includes(peer)) return true;
  }
  return false;
}

export function isChatEncrypted(conversationId: string | null | undefined): boolean {
  return !!conversationId && !!encrypted?.has(conversationId);
}

/** True when this chat, or any chat with this person, has "Encrypt chat" on. Loads the settings if needed. */
export async function chatWantsEncryption(conversationId: string, peerAddress: string | null | undefined): Promise<boolean> {
  const ids = await load();
  if (ids.has(conversationId)) return true;
  return wantsEncryptionTo(peerAddress);
}
