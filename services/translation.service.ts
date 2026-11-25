import { NativeModules, Platform } from 'react-native';
import { createLogger } from '../libs/logger';
import i18n from '../i18n';
import { storage } from '../libs/storage';
import { TranslationCooldown } from '../libs/translation-cooldown';
import { chatLineMatchesLanguage } from '../libs/chat-language-hint';
import { supabase } from './supabase';
import { cdnImageSource } from '../libs/cdnImage';
import { translateCopy as _translateCopy } from '../i18n/copy';
import { aiConsentDeclinedMessage, hasAiConsent } from '../libs/ai-consent';

const log = createLogger('translation.service');

export interface TranslateRequest {
  text: string;
  targetLang: string;
  sourceLang?: string;
  /**
   * Set only for content anyone can already read. The edge function keeps
   * absent-or-false text away from the free tiers that train on what they are
   * sent, so a direct message never reaches them.
   */
  public?: boolean;
}

export interface TranslateOptions {
  /**
   * The text is public: a post, a comment on one, a bio. Leave unset for
   * anything private — the default is private on purpose, so a call site that
   * forgets is the safe kind of wrong.
   */
  isPublic?: boolean;
  /** Allow a deliberate chat tap to retry an unconfirmed cached reply. */
  manualChat?: boolean;
}

export interface TranslateResponse {
  translatedText: string;
  detectedLanguage?: {
    language: string;
    confidence: number;
  };
  /**
   * Set by the edge function when the text was already in the target language,
   * so the body comes back untouched. Callers must not present that as a
   * translation — see the no-op handling in hooks/useTranslation.
   */
  sameLanguage?: boolean;
}

/** Error from the translation endpoint. */
export interface TranslateError {
  error: string;
  status: number;
}

const MAX_CACHE = 200;

interface CacheEntry {
  translatedText: string;
  sourceLang: string | null;
  sameLanguage?: boolean;
}

/** Simple LRU cache backed by a Map (insertion order). */
const cache = new Map<string, CacheEntry>();

// Keyed on the whole text, not a 200-char prefix.
//
// Truncating was survivable while this cache died with the session: two posts
// sharing an opening paragraph would swap translations until the next launch.
// Now that entries are persisted, a collision outlives the app — and posts that
// share a long prefix are not hypothetical here, they are reposts and templated
// announcements. Web keys on the full text for the same reason.
function cacheKey(text: string, targetLang: string): string {
  return `${text}::${targetLang}`;
}

// A short chat message can never translate into a page of model instructions.
function isExpandedExample(source: string, output: string): boolean {
  const original = source.trim();
  return original.length <= 80 && !original.includes("\n") &&
    output.length > Math.max(160, original.length * 12) && output.includes("\n");
}

function getCached(text: string, targetLang: string): CacheEntry | undefined {
  const key = cacheKey(text, targetLang);
  const entry = cache.get(key);
  if (entry && isExpandedExample(text, entry.translatedText)) {
    cache.delete(key);
    schedulePersist();
    return undefined;
  }
  if (entry) {
    cache.delete(key);
    cache.set(key, entry);
  }
  return entry;
}

function setCache(text: string, targetLang: string, entry: CacheEntry): void {
  const key = cacheKey(text, targetLang);
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, entry);
  schedulePersist();
}

// ---------------------------------------------------------------------------
// Persistence
//
// Session-only caching was survivable when a translation cost one deliberate
// button press. Now that the feed translates itself, a cold start meant
// re-requesting every post on screen — free for the reader, but a paid call for
// us on anything the shared server cache has since evicted, and a visible
// re-flicker either way. Persisting makes a relaunch cost nothing.
//
// Older device caches can still hold segmented or otherwise rejected server
// responses. Refill from the updated endpoint after the app upgrades.
const TRANSLATION_STORE_KEY = 'dehub-translation-cache-v4';
const LEGACY_TRANSLATION_STORE_KEY = 'dehub-translation-cache-v3';

function loadPersistedTranslations(): void {
  try {
    storage.delete(LEGACY_TRANSLATION_STORE_KEY);
    const raw = storage.getString(TRANSLATION_STORE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, CacheEntry][];
    if (!Array.isArray(entries)) return;
    // Oldest first, so the in-memory eviction order matches what was stored.
    for (const [key, value] of entries.slice(-MAX_CACHE)) {
      if (value && typeof value.translatedText === 'string') cache.set(key, value);
    }
  } catch {
    // A corrupt blob is not worth failing a launch over; the cache starts
    // empty and refills.
  }
}
loadPersistedTranslations();

// Writing on every hit would serialise the whole map per translated post during
// a scroll. Coalesce into one write per tick instead.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      storage.set(TRANSLATION_STORE_KEY, JSON.stringify(Array.from(cache.entries())));
    } catch {
      // Storage full or unavailable. The in-memory cache still works for this
      // session.
    }
  }, 1000);
}

// The same (text, language) pair is routinely asked for by more than one
// component at once — a repost shows the same body twice on one screen, and a
// card and its detail view mount together on navigation. Sharing the promise
// makes those one request instead of several identical ones landing on the edge
// function within a frame.
const inFlightRequests = new Map<string, Promise<TranslateResponse>>();
const translationCooldown = new TranslationCooldown();

/**
 * Pull the status and body out of a supabase-js function error.
 *
 * Reading the body consumes the response, so this is only ever called on a
 * failure, where nothing else will want it. Never throws: a diagnostic that can
 * fail is worse than one that returns nothing.
 */
async function describeFunctionError(
  error: unknown,
): Promise<{ status?: number; body?: string }> {
  const response = (error as { context?: unknown })?.context;
  if (!(response instanceof Response)) return {};
  const status = response.status;
  try {
    const body = (await response.clone().text()).slice(0, 300);
    return { status, body };
  } catch {
    return { status };
  }
}

function requestTranslation(
  text: string,
  targetLang: string,
  sourceLang: string,
  isPublic: boolean,
): Promise<TranslateResponse> {
  const key = `${cacheKey(text, targetLang)}-${isPublic ? 'p' : 'x'}`;
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const request = (async () => {
    translationCooldown.assertReady(key);
    const { data, error } = await supabase.functions.invoke('translate-text', {
      body: (isPublic
        ? { text, targetLang, sourceLang, public: true }
        : { text, targetLang, sourceLang }) satisfies TranslateRequest,
    });
    if (error) {
      await translationCooldown.observe(key, error);
      // `FunctionsHttpError` says only "returned a non-2xx status code", which
      // is the same sentence whether the function rejected the language, ran
      // out of budget, rate-limited the caller or fell over — four different
      // problems, one indistinguishable log. The response hangs off `context`;
      // read the status and body so the row names the branch that failed.
      const { status, body } = await describeFunctionError(error);
      log.error('translate-text failed:', error, { status, body, targetLang });
      throw new TranslationServiceError(
        body || error.message || 'Translation failed',
        status ?? 500,
      );
    }
    return (data ?? {}) as TranslateResponse;
  })();

  inFlightRequests.set(key, request);
  // Settled either way — a failure must not pin the key and make every later
  // attempt at this text replay the same rejection.
  request
    .catch(() => {})
    .then(() => {
      inFlightRequests.delete(key);
    });
  return request;
}

export function getDeviceLanguage(): string {
  try {
    let locale: string | undefined;
    if (Platform.OS === 'ios') {
      locale =
        NativeModules.SettingsManager?.settings?.AppleLocale ??
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0];
    } else {
      locale = NativeModules.I18nManager?.localeIdentifier;
    }
    if (locale) return locale.split(/[-_]/)[0].toLowerCase();
  } catch {
    // ignore
  }
  return 'en';
}

/**
 * The language translations should target: what the user picked in Settings
 * (persisted as `user-preferred-language` and applied to i18n), falling back to
 * the device locale only when no choice has been made.
 *
 * Never read the device locale on its own for this — a user running an
 * English phone with Riftn set to Turkish would get English "translations",
 * and posts already in English would be judged same-language and lose their
 * translate button entirely. Call this at use time, not at module scope: the
 * language can change mid-session from the Settings picker.
 */
export function getUserLanguage(): string {
  const chosen = i18n?.language;
  if (chosen) {
    const normalized = chosen.split(/[-_]/)[0].toLowerCase();
    if (normalized) return normalized;
  }
  return getDeviceLanguage();
}

export interface TranslateTextResult {
  translatedText: string;
  sourceLang: string | null;
  /**
   * True when nothing was translated because the text was already in the
   * target language — either the server said so, or it handed the body back
   * unchanged. Distinct from a failure: the answer is correct and final.
   */
  sameLanguage: boolean;
  /**
   * Came back unchanged without evidence that it is in the target language.
   */
  untranslated?: boolean;
}

function baseCode(lang: string | null | undefined): string {
  return (lang || '').split(/[-_]/)[0].toLowerCase();
}

function looksUntranslated(sameLanguage: boolean, detected: string | null, targetLang: string): boolean {
  if (!sameLanguage) return false;
  const code = baseCode(detected);
  return !code || code === 'auto' || code === 'und' || code !== baseCode(targetLang);
}

// A translation that came back as the text it was given did not translate
// anything. Compared loosely because providers normalise trailing whitespace.
function isNoOpTranslation(translated: string, original: string): boolean {
  return translated.trim() === original.trim();
}

export async function translateText(
  text: string,
  targetLang: string,
  sourceLang: string = 'auto',
  { isPublic = false, manualChat = false }: TranslateOptions = {},
): Promise<TranslateTextResult> {
  if (!text || text.trim().length < 1) {
    return { translatedText: text, sourceLang: null, sameLanguage: true };
  }
  // Callers the user tapped ask first (ensureAiConsent); this only stops
  // anything that didn't from sending.
  if (!hasAiConsent()) throw new TranslationServiceError(aiConsentDeclinedMessage(), 403);

  const resolvedSource = (source: string | null): string | null => {
    if (!manualChat || (source && !['auto', 'und', 'unknown'].includes(baseCode(source)))) return source;
    return chatLineMatchesLanguage(text, targetLang) ? targetLang : source;
  };

  const cached = getCached(text, targetLang);
  if (cached) {
    const cachedSame = cached.sameLanguage ?? isNoOpTranslation(cached.translatedText, text);
    const source = cachedSame ? resolvedSource(cached.sourceLang) : cached.sourceLang;
    const untranslated = looksUntranslated(cachedSame, source, targetLang);
    if (!manualChat || !untranslated) {
      log.debug('Cache hit for translation');
      return {
        translatedText: cached.translatedText,
        sourceLang: source,
        sameLanguage: cachedSame,
        ...(untranslated ? { untranslated: true } : {}),
      };
    }
    cache.delete(cacheKey(text, targetLang));
    schedulePersist();
  }

  log.debug('Translating text', { targetLang, sourceLang, length: text.length });

  const data = await requestTranslation(text, targetLang, sourceLang, isPublic);

  if (!data?.translatedText || isExpandedExample(text, data.translatedText)) {
    throw new TranslationServiceError('Translation unavailable', 500);
  }

  const sameLanguage = data.sameLanguage === true || isNoOpTranslation(data.translatedText, text);
  const detectedLang = data.detectedLanguage?.language ?? null;
  const source = sameLanguage ? resolvedSource(detectedLang) : detectedLang;
  const untranslated = data.sameLanguage !== true && looksUntranslated(sameLanguage, source, targetLang);

  // Keep a settled answer. An unconfirmed chat echo should allow a fresh tap.
  if (!manualChat || !untranslated) {
    setCache(text, targetLang, {
      translatedText: data.translatedText,
      sourceLang: data.sameLanguage === true ? targetLang : source,
      sameLanguage,
    });
  }

  return {
    translatedText: data.translatedText,
    sourceLang: source,
    sameLanguage,
    ...(untranslated ? { untranslated: true } : {}),
  };
}

export interface ImageTranslateResponse {
  extractedText: string;
  translatedText: string;
  sourceLang: string;
  hasText: boolean;
}

export async function translateImage(
  imageUrl: string,
  targetLang: string,
): Promise<ImageTranslateResponse> {
  if (!hasAiConsent()) throw new TranslationServiceError(aiConsentDeclinedMessage(), 403);
  // The uploaded picture, not the resized copy the feed shows: the reader
  // behind the translation cannot open resized links and answered with an
  // error for every feed photo.
  const { data, error } = await supabase.functions.invoke('translate-image', {
    body: { imageUrl: cdnImageSource(imageUrl), targetLang },
  });

  if (error) {
    log.error('translate-image failed:', error);
    throw new TranslationServiceError(error.message || _translateCopy("copy.f99f7b6a0421", { defaultValue: "Image translation failed" }), 500);
  }

  if (data?.error) {
    throw new TranslationServiceError(data.error, 500);
  }

  return {
    extractedText: data.extractedText || '',
    translatedText: data.translatedText || '',
    sourceLang: data.sourceLang || '',
    hasText: data.hasText ?? false,
  };
}

export class TranslationServiceError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TranslationServiceError';
    this.status = status;
  }
}

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ru: 'Russian',
  tr: 'Turkish',
  id: 'Indonesian',
  pl: 'Polish',
  uk: 'Ukrainian',
  tl: 'Tagalog',
  ar: 'Arabic',
  hi: 'Hindi',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  th: 'Thai',
  vi: 'Vietnamese',
  ms: 'Malay',
  nl: 'Dutch',
  ro: 'Romanian',
  sw: 'Swahili',
  pcm: 'Nigerian Pidgin',
  arz: 'Egyptian Arabic',
  ary: 'Moroccan Arabic',
  ha: 'Hausa',
};
