/**
 * "Send in their language" (one-to-one chats, off unless turned on in the
 * chat's menu). Mirrors web lib/dm-translate-out.ts.
 *
 * Your line is translated here, before it is sent, into the language the
 * other person reads Riftn in. They get it in their language everywhere
 * (chat, pushes, the Messages list); you keep seeing what you typed, and
 * either of you can flip to the other version on the bubble.
 *
 * The setting is your own, saved with your other chat settings so it follows
 * you between devices. Encrypted chats are left alone: the typed version
 * would have to sit next to the ciphertext in the clear.
 */
import { apiClient } from "./api.client";

type PrefRow = { conversationId: string; translateOutAt?: string | null; encryptedAt?: string | null };

// Filled by useChatPrefs, which every chat screen mounts. Until it has loaded,
// lines go as typed.
let chats = new Set<string>();
let encrypted = new Set<string>();

/** Fed from the chat settings query whenever it changes. */
export function setTranslateOutChats(prefs: PrefRow[] | undefined | null): void {
  chats = new Set((prefs ?? []).filter((p) => !!p.translateOutAt).map((p) => p.conversationId));
  encrypted = new Set((prefs ?? []).filter((p) => !!p.encryptedAt).map((p) => p.conversationId));
}

/** Sign-out: forget the last person's choices. */
export function clearTranslateOutChats(): void {
  chats = new Set();
  encrypted = new Set();
  languages.clear();
}

/** Synchronous, so a chat with the switch off sends exactly as before. */
export function isTranslateOutOn(conversationId: string | null | undefined): boolean {
  return !!conversationId && chats.has(conversationId) && !encrypted.has(conversationId);
}

const languages = new Map<string, Promise<string | null>>();

/** The language the other person reads Riftn in, or null when they never picked one. */
export function peerLanguage(conversationId: string): Promise<string | null> {
  let hit = languages.get(conversationId);
  if (!hit) {
    hit = apiClient
      .get(`/dm/peer-language/${encodeURIComponent(conversationId)}`, { isAuthRequired: true } as any)
      .then((res: any) => {
        const lang = (res?.result ?? res?.data?.result)?.language;
        return typeof lang === "string" && /^[a-z]{2,3}$/.test(lang) ? lang : null;
      })
      .catch(() => {
        // A failed lookup is not an answer: ask again next time.
        languages.delete(conversationId);
        return null;
      });
    languages.set(conversationId, hit);
  }
  return hit;
}

/** "English", "Türkçe"... in the reader's own language. Falls back to the code. */
export function languageName(code: string, inLang?: string): string {
  try {
    const names = new (Intl as any).DisplayNames([inLang || "en"], { type: "language" });
    const name = names.of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(inLang) + name.slice(1);
  } catch { /* Hermes without DisplayNames */ }
  return code.toUpperCase();
}

const HAS_LETTERS = /\p{L}/u;
const TIMEOUT_MS = 6000;

export interface TranslatedLine {
  /** What goes out: the line in their language. */
  content: string;
  /** What you typed. */
  original: string;
  /** Their language. */
  lang: string;
}

/**
 * Your line in their language, or null to send it as typed: the setting is
 * off, the chat is encrypted, they have no language, it already reads in
 * their language, or the translator did not answer in time. Sending never
 * waits more than a few seconds on this and never fails because of it.
 */
export async function translateOutgoing(conversationId: string, text: string): Promise<TranslatedLine | null> {
  const typed = text.trim();
  if (!typed || !HAS_LETTERS.test(typed)) return null;
  try {
    if (!isTranslateOutOn(conversationId)) return null;
    // Loaded here, not at the top: the send queue imports this file and must
    // not pull the translator (and i18n with it) in before a chat needs it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { translateText } = require("../services/translation.service") as typeof import("../services/translation.service");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hasAiConsent } = require("./ai-consent") as typeof import("./ai-consent");
    if (!hasAiConsent()) return null;
    const lang = await peerLanguage(conversationId);
    if (!lang) return null;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const res = await Promise.race([translateText(typed, lang, "auto", { isPublic: false }), timeout]);
    if (!res || res.sameLanguage || res.untranslated) return null;
    const out = res.translatedText?.trim() ?? "";
    if (!out || out.replace(/\s+/g, " ").toLowerCase() === typed.replace(/\s+/g, " ").toLowerCase()) return null;
    return { content: out, original: typed, lang };
  } catch {
    return null;
  }
}
