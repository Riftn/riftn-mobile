/**
 * Translate a post draft before it is posted (AI menu > Translate), like web's
 * src/features/post/post-translate.ts. The draft is private until posted, so
 * it goes to the translator as private text.
 */
import { storage } from "./storage";
import { SUPPORTED_LANGUAGES } from "../i18n";

const LANG_KEY = "postTranslateLang";

export type DraftTranslation = { text: string; from: string | null; same: boolean };

export function rememberedTranslateLang(): string {
  try { return storage.getString(LANG_KEY) || "en"; } catch { return "en"; }
}

export function rememberTranslateLang(lang: string): void {
  try { storage.set(LANG_KEY, lang); } catch { /* storage unavailable */ }
}

export function translateLanguageName(code: string | null | undefined): string | null {
  if (!code) return null;
  const hit = SUPPORTED_LANGUAGES.find((l) => l.code === code.toLowerCase());
  return hit ? hit.nativeName : null;
}

/** The last language used, English, the app language, then the rest by name. */
export function orderedTranslateLanguages(appLang: string, last: string) {
  const byCode = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));
  const front = [last, "en", appLang].filter((c, i, a) => byCode.has(c) && a.indexOf(c) === i);
  const rest = SUPPORTED_LANGUAGES
    .filter((l) => !front.includes(l.code))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...front.map((c) => byCode.get(c)!), ...rest];
}

export async function translateDraft(text: string, targetLang: string): Promise<DraftTranslation> {
  // Inline require: the translation service pulls in i18n/expo-localization,
  // which the composer's light test suites should not load.
  const { translateText } = require("../services/translation.service") as typeof import("../services/translation.service");
  const typed = text.trim();
  const res = await translateText(typed, targetLang, "auto", { isPublic: false });
  const out = (res.translatedText || "").trim();
  const from = res.sourceLang && res.sourceLang !== "auto" ? res.sourceLang.toLowerCase() : null;
  const same = res.sameLanguage === true || !out
    || out.replace(/\s+/g, " ").toLowerCase() === typed.replace(/\s+/g, " ").toLowerCase();
  return { text: out || typed, from, same };
}
