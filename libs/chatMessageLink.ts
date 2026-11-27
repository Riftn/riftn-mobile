/**
 * "Copy link" on a chat message, like Slack's, and opening one.
 *
 * Every link is an ordinary riftn.com page with `msg=<id>` added (the same
 * shapes web hands out, see riftn-web lib/chat-message-link), so it opens the
 * chat it came from here and on the web:
 *
 *   Public chat   /app/messages?chat=public&room=<roomId>&msg=<id>
 *   Stream chat   /app/post/<tokenId>?msg=<id>
 *   Community     /communities/<slug>?tab=chat&msg=<id>
 *   DM or group   /app/messages?conversation=<id>&msg=<id>
 *
 * getStateFromPath notes the target here and opens the right screen; the chat
 * takes it with useLinkedMessage once its history is in, scrolls to the line
 * and highlights it. A DM link opens only for people in that chat.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { copyToClipboard } from "./clipboard.utils";
import { toastInfo, toastSuccess } from "./toast";
import { translateCopy } from "../i18n/copy";

const ORIGIN = "https://riftn.com";
export const MESSAGE_LINK_PARAM = "msg";

export type ChatLinkTarget =
  | { kind: "public"; roomId?: string | null }
  | { kind: "stream"; tokenId: string | number }
  | { kind: "community"; slug: string }
  | { kind: "dm"; conversationId: string };

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** A message id a link can name: a line still sending has none yet. */
export function canLinkMessage(id: string | null | undefined): id is string {
  return !!id && ID_RE.test(id) && !/^(temp|local|pending|optimistic)[-_]/i.test(id);
}

export function chatMessageLink(target: ChatLinkTarget, messageId: string): string {
  const msg = `${MESSAGE_LINK_PARAM}=${encodeURIComponent(messageId)}`;
  switch (target.kind) {
    case "public":
      return `${ORIGIN}/app/messages?chat=public${target.roomId ? `&room=${encodeURIComponent(target.roomId)}` : ""}&${msg}`;
    case "stream":
      return `${ORIGIN}/app/post/${encodeURIComponent(String(target.tokenId))}?${msg}`;
    case "community":
      return `${ORIGIN}/communities/${encodeURIComponent(target.slug)}?tab=chat&${msg}`;
    case "dm":
      return `${ORIGIN}/app/messages?conversation=${encodeURIComponent(target.conversationId)}&${msg}`;
  }
}

export const copyLinkLabel = () => translateCopy("copy.dbf362d4f210", { defaultValue: "Copy link" });

export function copyChatMessageLink(target: ChatLinkTarget, messageId: string) {
  copyToClipboard(chatMessageLink(target, messageId));
  toastSuccess(translateCopy("copy.d12860c21e78", { defaultValue: "Link copied" }));
}

export function chatLinkKey(target: ChatLinkTarget): string {
  switch (target.kind) {
    case "public": return "public";
    case "stream": return `stream:${target.tokenId}`;
    case "community": return `community:${target.slug.toLowerCase()}`;
    case "dm": return `dm:${target.conversationId}`;
  }
}

/** Reads a link's chat and message out of a path and query; null for any other link. */
export function parseChatMessageLink(pathOnly: string, queryString: string): { target: ChatLinkTarget; messageId: string } | null {
  const params = new URLSearchParams(queryString);
  const segs = pathOnly.split("/").filter(Boolean);
  const rest = segs[0] === "app" ? segs.slice(1) : segs;
  const legacyPublic = rest.length === 1 && (
    (rest[0] === "chat" && !params.has("chat")) ||
    (rest[0] === "messages" && params.get("chat") === "public")
  );
  const messageId = params.get(MESSAGE_LINK_PARAM) ?? (legacyPublic ? params.get("chatMessage") : null);
  if (!canLinkMessage(messageId)) return null;
  let target: ChatLinkTarget | null = null;
  if (rest.length === 1 && (rest[0] === "messages" || rest[0] === "chat")) {
    const conversation = params.get("conversation");
    if (conversation && ID_RE.test(conversation)) target = { kind: "dm", conversationId: conversation };
    else if (params.get("chat") === "public" || legacyPublic) {
      const room = params.get("room");
      target = { kind: "public", roomId: room && ID_RE.test(room) ? room : null };
    }
  } else if (rest.length === 2 && rest[0] === "post" && /^[A-Za-z0-9_-]{1,120}$/.test(rest[1])) {
    target = { kind: "stream", tokenId: rest[1] };
  } else if (rest.length === 2 && rest[0] === "communities" && rest[1] !== "join") {
    target = { kind: "community", slug: decodeURIComponent(rest[1]) };
  }
  return target ? { target, messageId } : null;
}

// ---------------------------------------------------------------------------
// The link waiting to be opened.

type Pending = { key: string; target: ChatLinkTarget; messageId: string; at: number; nonce: number };
let pending: Pending | null = null;
let nonce = 0;
const listeners = new Set<() => void>();
const PENDING_TTL_MS = 60_000;

export function setPendingChatLink(target: ChatLinkTarget, messageId: string) {
  nonce += 1;
  pending = { key: chatLinkKey(target), target, messageId, at: Date.now(), nonce };
  listeners.forEach((fn) => fn());
}

export function peekPendingChatLink(key?: string): Pending | null {
  if (!pending || Date.now() - pending.at > PENDING_TTL_MS) return null;
  if (key && pending.key !== key) return null;
  return pending;
}

export function clearPendingChatLink(n?: number) {
  if (!pending || (n != null && pending.nonce !== n)) return;
  pending = null;
}

export function toastLinkedMessageGone() {
  toastInfo(translateCopy("chatLink.gone", { defaultValue: "That message was deleted, or it's too far back to open." }));
}

export function toastNotInLinkedChat() {
  toastInfo(translateCopy("chatLink.notInChat", { defaultValue: "That link is to a private chat you're not in." }));
}

/** How long a linked line stays lit. */
export const LINK_HIGHLIGHT_MS = 4000;

/** The line a link opened on, lit for a few seconds. */
export function useLinkHighlight(): [string | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setId(next);
    timer.current = setTimeout(() => setId(null), LINK_HIGHLIGHT_MS);
  };
  return [id, flash];
}

/**
 * Opens the line a copied link names, once this chat is ready. `open` scrolls
 * to it (loading older history when it needs to) and says whether it found
 * it: false shows "deleted or too far back", null means the chat said why.
 */
export function useLinkedMessage(
  key: string | null,
  ready: boolean,
  open: (messageId: string) => Promise<boolean | null> | boolean | null,
) {
  const openRef = useRef(open);
  openRef.current = open;
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  const waitingNonce = key ? peekPendingChatLink(key)?.nonce : undefined;

  useEffect(() => {
    if (!key || !ready || busy.current) return;
    const link = peekPendingChatLink(key);
    if (!link) return;
    clearPendingChatLink(link.nonce);
    busy.current = true;
    void Promise.resolve()
      .then(() => openRef.current(link.messageId))
      .then(
        (found) => { busy.current = false; if (found === false && alive.current) toastLinkedMessageGone(); },
        () => { busy.current = false; if (alive.current) toastLinkedMessageGone(); },
      );
  }, [key, ready, waitingNonce]);
}
