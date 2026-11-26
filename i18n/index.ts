import { normalizeLanguageCode } from './language-code';
import { applyDateLocale } from './date-locale';
import manifest from './locale-manifest.json';
/**
 * i18n Configuration — Mobile (Expo/React Native)
 *
 * English is always bundled. Other languages are lazy-loaded on demand.
 * Works with expo-localization for device locale detection.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { languageForCountry } from '../libs/country-language';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';
import { I18nManager } from 'react-native';

/**
 * Locales written right to left. Arabic and its regional forms, Persian, Urdu
 * and the other Arabic-script languages this app ships, plus Hebrew.
 */
const RTL_LANGUAGES = new Set([
  'ar', 'acm', 'acw', 'aec', 'ajp', 'apd', 'ary', 'arz', 'ayn',
  'dcc', 'fa', 'he', 'pbt', 'ps', 'sd', 'skr', 'ug', 'ur',
]);

export const isRtlLanguage = (lang: string): boolean => RTL_LANGUAGES.has(lang);

/**
 * Point the native layout direction at the app language, not the phone's.
 *
 * React Native only reads the direction at startup, so a change takes effect
 * on the next launch; returns true when it changed so the caller can reload.
 * Without this, choosing Arabic in the app left every screen laid out left to
 * right, and an English choice on an Arabic phone came out mirrored.
 */
export function applyLayoutDirection(lang: string): boolean {
  const rtl = isRtlLanguage(lang);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
}

import en from './locales/en.json';
import { fillMissingPluralForms } from './plural-fallback';

import { shortenCounterPlaceholder } from '../libs/format-count';
const STORAGE_KEY = 'user-preferred-language';

// All supported languages (mirrors web app exactly)
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'dcc', name: 'Deccan', nativeName: 'دکنی' },
  { code: 'dyu', name: 'Jula', nativeName: 'Julakan' },
  { code: 'om', name: 'Oromo', nativeName: 'Afaan Oromoo' },
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans' },
  { code: 'az', name: 'Azerbaijani', nativeName: 'Azərbaycan' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'acm', name: 'Arabic, Mesopotamian Spoken', nativeName: 'عراقي' },
  { code: 'acw', name: 'Arabic, Hijazi Spoken', nativeName: 'حجازي' },
  { code: 'aec', name: "Arabic, Sa'idi Spoken", nativeName: 'صعيدي' },
  { code: 'ajp', name: 'Arabic, South Levantine Spoken', nativeName: 'شامي' },
  { code: 'ayn', name: 'Arabic, Sanaani Spoken', nativeName: 'صنعاني' },
  { code: 'apd', name: 'Arabic, Sudanese Spoken', nativeName: 'عربي سوداني' },
  { code: 'bho', name: 'Bhojpuri', nativeName: 'भोजपुरी' },
  { code: 'be', name: 'Belarusian', nativeName: 'Беларуская' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
  { code: 'my', name: 'Burmese', nativeName: 'မြန်မာ' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh_tw', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'cjy', name: 'Chinese, Jinyu', nativeName: '晋语' },
  { code: 'mnp', name: 'Chinese, Min Bei', nativeName: '闽北语' },
  { code: 'ctg', name: 'Chittagonian', nativeName: 'চাটগাঁইয়া' },
  { code: 'hne', name: 'Chhattisgarhi', nativeName: 'छत्तीसगढ़ी' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'arz', name: 'Egyptian Arabic', nativeName: 'مصرى' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'gsw', name: 'Swiss German', nativeName: 'Schwyzerdütsch' },
  { code: 'ha', name: 'Hausa', nativeName: 'Hausa' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { code: 'ig', name: 'Igbo', nativeName: 'Igbo' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'jv', name: 'Javanese', nativeName: 'Basa Jawa' },
  { code: 'kk', name: 'Kazakh', nativeName: 'Қазақша' },
  { code: 'ku', name: 'Kurdish', nativeName: 'Kurdî' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'lo', name: 'Lao', nativeName: 'ລາວ' },
  { code: 'mag', name: 'Magahi', nativeName: 'मगही' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'mn', name: 'Mongolian', nativeName: 'Монгол' },
  { code: 'mg', name: 'Malagasy', nativeName: 'Malagasy' },
  { code: 'yue', name: 'Cantonese', nativeName: '廣東話' },
  { code: 'wuu', name: 'Wu Chinese', nativeName: '吴语' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'ary', name: 'Moroccan Arabic', nativeName: 'الدارجة' },
  { code: 'km', name: 'Khmer', nativeName: 'ខ្មែរ' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली' },
  { code: 'pcm', name: 'Nigerian Pidgin', nativeName: 'Naijá' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
  { code: 'wes', name: 'Pidgin, Cameroon', nativeName: 'Kamtok' },
  { code: 'pbt', name: 'Pashto, Southern', nativeName: 'پښتو' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'qu', name: 'Quechua', nativeName: 'Runasimi' },
  { code: 'rkt', name: 'Rangpuri', nativeName: 'রংপুরী' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'sdr', name: 'Sadri', nativeName: 'सादरी' },
  { code: 'skr', name: 'Saraiki', nativeName: 'سرائیکی' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски' },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල' },
  { code: 'so', name: 'Somali', nativeName: 'Soomaali' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
  { code: 'syl', name: 'Sylheti', nativeName: 'ꠍꠤꠟꠐꠤ' },
  { code: 'tl', name: 'Tagalog', nativeName: 'Tagalog' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'tts', name: 'Thai, Northeastern', nativeName: 'อีสาน' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'uz', name: 'Uzbek', nativeName: 'Oʻzbek' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतम्' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'zu', name: 'Zulu', nativeName: 'isiZulu' },
  { code: 'ti', name: 'Tigrinya', nativeName: 'ትግርኛ' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu' },
  { code: 'mi', name: 'Maori', nativeName: 'Māori' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'sd', name: 'Sindhi', nativeName: 'سنڌي' },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip' },
  { code: 'ug', name: 'Uyghur', nativeName: 'ئۇيغۇرچە' },
  { code: 'tg', name: 'Tajik', nativeName: 'Тоҷикӣ' },
  { code: 'tk', name: 'Turkmen', nativeName: 'Türkmen' },
  { code: 'hy', name: 'Armenian', nativeName: 'Հայերեն' },
  { code: 'ky', name: 'Kyrgyz', nativeName: 'Кыргызча' }
];

// Lazy-loaders for all non-English locales
const packOrigin = process.env.EXPO_PUBLIC_LOCALE_PACK_ORIGIN || 'https://riftn.com';
// Downloaded packs live in their own MMKV file, never AsyncStorage. On Android
// AsyncStorage is one SQLite file capped at 6 MB; a single language is ~0.9 MB
// and every translation update used to add a fresh copy without dropping the
// old one, until the file was full and sign-in failed with SQLITE_FULL.
// Keep the last usable copy of each pack until its replacement downloads.
const packStore = new MMKV({ id: 'locale-packs' });
const LEGACY_PACK_PREFIX = 'locale-pack:';
// Move packs out of the small shared AsyncStorage database, including the last
// version so a first launch after updating can still use it offline.
const migrateLegacyPacks = AsyncStorage.getAllKeys()
  .then(async (keys) => {
    const legacy = keys.filter((key) => key.startsWith(LEGACY_PACK_PREFIX));
    if (!legacy.length) return;
    const moved: string[] = [];
    for (const [key, value] of await AsyncStorage.multiGet(legacy)) {
      if (value === null) continue;
      const cacheKey = key.slice(LEGACY_PACK_PREFIX.length);
      if (packStore.getString(cacheKey) === undefined) packStore.set(cacheKey, value);
      moved.push(key);
    }
    if (moved.length) await AsyncStorage.multiRemove(moved);
  })
  .catch(() => {});
const readPackCache = async (key: string): Promise<string | null> => {
  try {
    const value = packStore.getString(key);
    if (value !== undefined) return value;
  } catch {}
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_PACK_PREFIX + key);
    if (legacy !== null) {
      try { packStore.set(key, legacy); } catch {}
      AsyncStorage.removeItem(LEGACY_PACK_PREFIX + key).catch(() => {});
    }
    return legacy;
  } catch {
    return null;
  }
};
const previousPackKeys = (key: string) => {
  const suffix = key.slice(key.indexOf(':'));
  return packStore.getAllKeys().filter(candidate => candidate !== key && candidate.endsWith(suffix));
};
const writePackCache = async (key: string, value: string) => {
  try {
    packStore.set(key, value);
    for (const previous of previousPackKeys(key)) packStore.delete(previous);
  } catch {}
};

const loadedPacks = new Set<string>();
const offlinePacks = new Set<string>();
const retryAfter = new Map<string, number>();
const pendingPacks = new Map<string, Promise<boolean>>();
const pendingSourceLanguages = new Map<string, Promise<Record<string, unknown>>>();
async function loadSourceLanguage(lang: string): Promise<Record<string, unknown>> {
  const key = `${manifest.version}:${lang}:source`;
  if (pendingSourceLanguages.has(key)) return pendingSourceLanguages.get(key)!;
  const pending = (async () => {
    const cached = await readPackCache(key);
    if (cached) return JSON.parse(cached);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://raw.githubusercontent.com/Riftn/riftn-mobile/${manifest.sourceRef}/i18n/locales/${lang}.json`, { signal: controller.signal });
      if (!response.ok) throw new Error('Language source unavailable');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid language source');
      await writePackCache(key, JSON.stringify(data));
      return data;
    } finally { clearTimeout(timeout); }
  })().finally(() => { pendingSourceLanguages.delete(key); });
  pendingSourceLanguages.set(key, pending);
  return pending;
}
async function loadPack(lang: string, group: string): Promise<boolean> {
  if (lang === 'en') return true;
  if (!manifest.languages.includes(lang)) return false;
  const key = `${manifest.version}:${lang}:${group}`;
  if (loadedPacks.has(key)) return true;
  if ((retryAfter.get(key) || 0) > Date.now()) return offlinePacks.has(key);
  if (pendingPacks.has(key)) return pendingPacks.get(key)!;
  const pending = (async () => {
    try {
      const cached = await readPackCache(key);
      let data: Record<string, unknown>;
      if (cached) data = JSON.parse(cached);
      else {
        const cachedSource = await readPackCache(`${manifest.version}:${lang}:source`);
        if (cachedSource) data = JSON.parse(cachedSource);
        else {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          try {
            const response = await fetch(`${packOrigin}/locale-packs/mobile/${manifest.version}/${lang}/${group}.json`, { signal: controller.signal });
            if (!response.ok) throw new Error('Locale pack unavailable');
            data = await response.json();
          } catch {
            data = await loadSourceLanguage(lang);
          } finally { clearTimeout(timeout); }
          if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
          await writePackCache(key, JSON.stringify(data));
        }
      }
      // Mark first: resource events rerender consumers synchronously.
      loadedPacks.add(key);
      offlinePacks.delete(key);
      i18n.addResourceBundle(lang, 'translation', data, true, true);
      fillMissingPluralForms(i18n, lang);
      return true;
    } catch {
      retryAfter.set(key, Date.now() + 30_000);
      if (offlinePacks.has(key)) return true;
      try {
        await migrateLegacyPacks;
        const previousKeys = [...previousPackKeys(key), ...previousPackKeys(`${manifest.version}:${lang}:source`)];
        for (const previous of previousKeys) {
          const cached = packStore.getString(previous);
          if (!cached) continue;
          try {
            const bundle = JSON.parse(cached);
            if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) continue;
            offlinePacks.add(key);
            i18n.addResourceBundle(lang, 'translation', bundle, true, false);
            fillMissingPluralForms(i18n, lang);
            return true;
          } catch { /* Try another cached copy. */ }
        }
      } catch { /* Locale storage is unavailable. */ }
      return false;
    }
    finally { pendingPacks.delete(key); }
  })();
  pendingPacks.set(key, pending);
  return pending;
}
const requestedGroups = new Set<string>(['core']);
const groupForKey = (key: string) => (manifest.groups as Record<string, string>)[key.split('.')[0]];
i18n.use({
  type: 'postProcessor', name: 'featurePacks',
  process(value: string, keys: string[], options: { defaultValue?: unknown; lng?: unknown }) {
    const group = groupForKey(keys[0] || '');
    if (group) {
      requestedGroups.add(group);
      const lang = typeof options.lng === 'string' ? options.lng : i18n.language || 'en';
      const inlineEnglish = typeof options.defaultValue === 'string' && options.defaultValue.length > 0;
      // Native already ships English. Reuse that resource before reaching for
      // a remote pack, including labels that have no inline fallback.
      const bundledEnglish = i18n.getResource('en', 'translation', keys[0] || '') !== undefined;
      if (lang !== 'en' || (!inlineEnglish && !bundledEnglish)) void loadPack(lang, group);
    }
    return value;
  },
});
// The app boots in English and switches once the saved or device language has
// loaded. Until then i18n.language is that placeholder, not the reader's
// choice, so anything that reports the language (AccountLanguageSync) waits.
let languageSettled = false;
let settle: () => void = () => {};
export const languageReady = new Promise<void>(resolve => {
  settle = () => { languageSettled = true; resolve(); };
});
export const isLanguageReady = () => languageSettled;

export async function loadLanguage(lang: string): Promise<boolean> {
  const groups = ['ar', 'es', 'fr', 'nl', 'tr'].includes(lang)
    ? [...new Set(Object.values(manifest.groups))]
    : [...requestedGroups];
  const results = await Promise.all(groups.map(group => loadPack(lang, group)));
  // Optional feature packs must not prevent an offline reader using cached core copy.
  return results[groups.indexOf('core')] ?? false;
}
/**
 * Switch the app to `code` and remember it.
 *
 * Loads before persisting: a locale that fails to load must not be saved as
 * the preference, or every launch comes up in English. Returns whether the
 * layout direction changed, which only takes effect after a restart; the
 * caller decides when to reload.
 */
export async function chooseLanguage(code: string): Promise<{ ok: boolean; needsReload: boolean }> {
  try {
    const loaded = await loadLanguage(code);
    if (!loaded) return { ok: false, needsReload: false };
    await AsyncStorage.setItem(STORAGE_KEY, code);
    await i18n.changeLanguage(code);
    settle();
    return { ok: true, needsReload: applyLayoutDirection(code) };
  } catch {
    return { ok: false, needsReload: false };
  }
}

/**
 * Detect the best language from device locale, falling back to stored preference.
 */
export function detectLanguage(): string {
  const locales = Localization.getLocales?.() || [];
  const first = locales[0];
  return normalizeLanguageCode(first?.languageTag || first?.languageCode || 'en');
}

/**
 * The language first-run setup starts on, when it differs from the phone's.
 *
 * A phone left in English (or in a language the app doesn't ship) in a
 * country with one main language starts setup on that country's language:
 * a phone in English in Türkiye opens setup in Turkish, with English one tap
 * away. A phone set to any other shipped language keeps it. Null means setup
 * stays on the phone's language.
 */
export function detectCountryLanguage(): string | null {
  const locales = Localization.getLocales?.() || [];
  const first = locales[0];
  const phone = normalizeLanguageCode(first?.languageTag || first?.languageCode || 'en');
  const phoneShipped = SUPPORTED_LANGUAGES.some((l) => l.code === phone);
  if (phoneShipped && phone !== 'en') return null;
  const region = locales[0]?.regionCode || locales.find((l) => l.regionCode)?.regionCode;
  const country = languageForCountry(region);
  if (!country || country === phone || !SUPPORTED_LANGUAGES.some((l) => l.code === country)) return null;
  return country;
}

/** Whether the reader has ever picked a language (in setup or Settings). */
export async function hasChosenLanguage(): Promise<boolean> {
  try {
    return !!(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    return true;
  }
}

// Initialize with English bundled
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: 'en',
  fallbackLng: 'en',
  postProcess: ['featurePacks'],
  react: { bindI18nStore: 'added' },
  interpolation: {
    escapeValue: false,
    // Every placeholder goes through the formatter below, so counters can be shortened.
    alwaysFormat: true,
  },
  compatibilityJSON: 'v4',
});

// Counters in copy ({{count}} listens, {{views}} views...) read short, 1.2K not
// 1200, the same as everywhere else in the app. Named formats ({{x, number}})
// still go to i18next's own formatter.
{
  const interpolator = (i18n.services as any)?.interpolator;
  const baseFormat = interpolator?.format;
  if (interpolator && typeof baseFormat === 'function') {
    interpolator.format = (value: unknown, format: string | undefined, lng: string | undefined, options: Record<string, unknown> | undefined) =>
      format ? baseFormat(value, format, lng, options) : shortenCounterPlaceholder(value, format, lng, options);
  }
}

applyDateLocale(i18n.language || 'en');
i18n.on('languageChanged', applyDateLocale);

// iPhone number pads have no return key, so every one of them gets a bar with
// this word on it that closes the keyboard (patches/react-native, TextInput).
const applyKeyboardDoneLabel = () => {
  (globalThis as { __keyboardDoneLabel?: string }).__keyboardDoneLabel = i18n.t('common.done');
};
applyKeyboardDoneLabel();
i18n.on('languageChanged', applyKeyboardDoneLabel);

// English needs one pass too: governance.proposalCount and postInfo.owner ship
// only an _other, so t(key, { count: 1 }) resolved to nothing.
fillMissingPluralForms(i18n, 'en');

// Connection copy only needs the local choice, even if no locale pack can load.
export const startupLanguage = AsyncStorage.getItem(STORAGE_KEY)
  .then(saved => saved || detectLanguage());

// On startup, switch to saved or device language
(async () => {
  try {
    const target = await startupLanguage;
    let active = i18n.language || 'en';
    // English that only stands in for a pack that failed to load is not the
    // reader's language: stay unsettled so it is never reported as theirs.
    let settled = !target || target === 'en';
    if (target && target !== 'en') {
      const ok = await loadLanguage(target);
      if (ok && i18n.language === 'en') {
        await i18n.changeLanguage(target);
        active = target;
      }
      settled = ok || i18n.language !== 'en';
    }
    if (settled) settle();
    // No reload here: at boot that could loop. The next launch picks it up,
    // and the language picker reloads straight away.
    applyLayoutDirection(active);
  } catch {
    // Silently fall back to English
  }
})();

export default i18n;
