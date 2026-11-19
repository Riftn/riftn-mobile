/**
 * Live subtitles in calls: the wire format, the viewer's choices, and the
 * call's private channel. Matches the website (src/lib/stage-captions.ts) so a
 * phone and a browser on the same call read each other.
 *
 * Each person's phone transcribes their own microphone, translates each
 * finished sentence into the languages the others are reading, and broadcasts
 * both. A call's captions ride a channel name the server gives only to people
 * on the call, and a person is only transcribed while someone else is reading.
 */
import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "i18next";
import { supabase } from "../services/supabase";
import { getAuthToken } from "./auth.utils";

export const CAPTION_EVENT = "caption";
export const CAPTION_TRANSLATION_EVENT = "caption-translation";
/** Presence value of a reader who reads the spoken language. */
export const CAPTION_SOURCE_LANGUAGE = "source";
export const CAPTION_FINAL_TTL_MS = 9000;
export const CAPTION_INTERIM_TTL_MS = 5000;
export const CAPTION_MAX_LINES = 3;

export interface CaptionMessage {
  id: string;
  wallet: string;
  name: string;
  text: string;
  final: boolean;
  kind: "speech" | "ai";
  at: number;
}

export interface CaptionTranslation {
  id: string;
  translations: Record<string, string>;
}

/** The same list as the website and the translate function's allowlist. */
export const CAPTION_LANGUAGES: Array<{ code: string; name: string }> = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "pt", name: "Português" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
  { code: "ar", name: "العربية" },
  { code: "hi", name: "हिन्दी" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
  { code: "id", name: "Bahasa Indonesia" },
];

// ─── Viewer choices ─────────────────────────────────────────────────────────

const SHOW_KEY = "riftn.call.captions.show";
const SEND_KEY = "riftn.call.captions.send";
const LANG_KEY = "riftn.call.captions.lang";

const isCaptionLanguage = (code: string | null | undefined): code is string =>
  !!code && CAPTION_LANGUAGES.some((l) => l.code === code);

function uiLanguage(): string | null {
  const code = (i18n.resolvedLanguage || i18n.language || "").split(/[-_]/)[0].toLowerCase();
  return isCaptionLanguage(code) ? code : null;
}

interface CaptionPrefs {
  /** Reading subtitles in calls. Starts off: a call is private. */
  show: boolean;
  /** Letting others read what you say. */
  send: boolean;
  /** The language you read in; null for the spoken one. */
  language: string | null;
}

let prefs: CaptionPrefs = { show: false, send: true, language: uiLanguage() };
let pickedLanguage = false;
/** Choices made before the saved ones load win over the saved ones. */
const touched = { show: false, send: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

void AsyncStorage.multiGet([SHOW_KEY, SEND_KEY, LANG_KEY]).then((rows) => {
  const read = Object.fromEntries(rows);
  const lang = read[LANG_KEY];
  const pickedEarlier = pickedLanguage;
  pickedLanguage = pickedLanguage || lang != null;
  prefs = {
    show: touched.show ? prefs.show : read[SHOW_KEY] === "1",
    send: touched.send ? prefs.send : read[SEND_KEY] !== "0",
    language: pickedEarlier ? prefs.language : lang === "source" ? null : isCaptionLanguage(lang) ? lang : prefs.language,
  };
  emit();
}).catch(() => { /* defaults stand */ });

i18n.on?.("languageChanged", () => {
  if (pickedLanguage) return;
  const next = uiLanguage();
  if (next === prefs.language) return;
  prefs = { ...prefs, language: next };
  emit();
});

export function useCallCaptionPrefs(): CaptionPrefs {
  return useSyncExternalStore(subscribe, () => prefs, () => prefs);
}

export function setShowCallCaptions(show: boolean) {
  touched.show = true;
  if (prefs.show === show) return;
  prefs = { ...prefs, show };
  void AsyncStorage.setItem(SHOW_KEY, show ? "1" : "0").catch(() => {});
  emit();
}

export function setSendCallCaptions(send: boolean) {
  touched.send = true;
  if (prefs.send === send) return;
  prefs = { ...prefs, send };
  void AsyncStorage.setItem(SEND_KEY, send ? "1" : "0").catch(() => {});
  emit();
}

export function setCallCaptionLanguage(language: string | null) {
  if (language !== null && !isCaptionLanguage(language)) return;
  pickedLanguage = true;
  prefs = { ...prefs, language };
  void AsyncStorage.setItem(LANG_KEY, language ?? "source").catch(() => {});
  emit();
}

// ─── Server calls ───────────────────────────────────────────────────────────

async function authHeaders(wallet: string): Promise<Record<string, string> | null> {
  const token = await getAuthToken();
  if (!token) return null;
  return { "x-dehub-token": token, "x-wallet-address": wallet.toLowerCase() };
}

/** The call's private caption channel, or null if the server would not say. */
export async function fetchCallCaptionTopic(room: string, wallet: string): Promise<string | null> {
  const headers = await authHeaders(wallet);
  if (!headers) return null;
  const { data, error } = await supabase.functions.invoke("stage-caption-token", {
    body: { spaceId: room, topicOnly: true },
    headers,
  });
  if (error || typeof data?.topic !== "string" || !data.topic) return null;
  return `call-captions:${data.topic}`;
}

export interface CaptionCredential { token: string; scheme: "bearer" | "token"; params: Record<string, string> }

/** A short-lived transcriber credential for this person on this call. */
export async function fetchCaptionCredential(room: string, wallet: string): Promise<CaptionCredential | null> {
  try {
    const headers = await authHeaders(wallet);
    if (!headers) return null;
    const { data, error } = await supabase.functions.invoke("stage-caption-token", { body: { spaceId: room }, headers });
    if (error || !data?.token) return null;
    return { token: data.token, scheme: data.scheme === "bearer" ? "bearer" : "token", params: data.params ?? {} };
  } catch {
    return null;
  }
}

/** Translate one finished line into the languages others read. */
export async function translateCaption(
  room: string, wallet: string, lineId: string, text: string, context: string, languages: string[],
): Promise<Record<string, string> | null> {
  try {
    const headers = await authHeaders(wallet);
    if (!headers) return null;
    const { data, error } = await supabase.functions.invoke("translate-caption", {
      body: { spaceId: room, lineId, text, context, languages },
      headers,
    });
    if (error || !data?.translations) return null;
    return data.translations as Record<string, string>;
  } catch {
    return null;
  }
}

/** Speak a finished line in the languages someone has paid to hear (they paid on the website). */
export async function dubCaption(
  room: string, wallet: string, lineId: string, items: Array<{ lang: string; text: string; token: string }>,
): Promise<Record<string, string> | null> {
  try {
    const headers = await authHeaders(wallet);
    if (!headers) return null;
    const { data, error } = await supabase.functions.invoke("dub-line", {
      body: { spaceId: room, lineId, items },
      headers,
    });
    if (error || !data?.audio) return null;
    return data.audio as Record<string, string>;
  } catch {
    return null;
  }
}

/** Loudness of one 16-bit little-endian PCM frame, 0..1. */
export function frameLevel(pcm: Uint8Array): number {
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    let v = pcm[i * 2] | (pcm[i * 2 + 1] << 8);
    if (v >= 0x8000) v -= 0x10000;
    const f = v / 32768;
    sum += f * f;
  }
  return Math.sqrt(sum / samples);
}

export function newUtteranceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
