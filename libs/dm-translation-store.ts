import { useCallback, useSyncExternalStore } from 'react';
import i18n from 'i18next';
import { translateText, getUserLanguage } from '../services/translation.service';
import { toastError, toastSuccess } from './toast';
import { ensureAiConsent, hasAiConsent } from './ai-consent';
import { chatLineIsForeign } from './chat-language-hint';
import { takeAutoTranslateSlot } from './auto-translate-budget';

/**
 * Translate for direct messages. The menu (held message) starts it and the
 * bubble shows the result, so the state lives here, keyed by message id.
 *
 * Messages you receive also translate themselves (autoTranslateDm), on the
 * same rules as live chat, once the Auto-translate setting and AI permission
 * allow it. Either way the text goes out as private (isPublic false), so it
 * never reaches a provider that trains on its input.
 */
export type DmTranslation =
  | { status: 'loading' }
  | { status: 'shown'; text: string }
  | { status: 'hidden'; text: string };

const entries = new Map<string, DmTranslation>();
// Messages auto-translate has already looked at, so it asks once per message.
const autoTried = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

function set(id: string, next: DmTranslation | undefined) {
  if (next) entries.set(id, next);
  else entries.delete(id);
  listeners.get(id)?.forEach((fn) => fn());
}

/** Text worth translating: links and @/$ handles left out, they don't translate. */
export function dmTranslatableText(content?: string | null): string {
  return (content ?? '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Has at least a few letters, so emoji-only or link-only messages get no Translate. */
export function canTranslateDm(content?: string | null): boolean {
  return dmTranslatableText(content).replace(/[^\p{L}]/gu, '').length >= 2;
}

export function getDmTranslation(id: string): DmTranslation | undefined {
  return entries.get(id);
}

export function useDmTranslation(id: string | undefined): DmTranslation | undefined {
  const subscribe = useCallback((fn: () => void) => {
    if (!id) return () => {};
    let bucket = listeners.get(id);
    if (!bucket) listeners.set(id, (bucket = new Set()));
    bucket.add(fn);
    return () => { bucket!.delete(fn); };
  }, [id]);
  return useSyncExternalStore(subscribe, () => (id ? entries.get(id) : undefined));
}

/** Translate, or flip between the translation and the original. */
export async function toggleDmTranslation(id: string, content?: string | null): Promise<void> {
  const current = entries.get(id);
  if (current?.status === 'loading') return;
  if (current?.status === 'shown') return set(id, { status: 'hidden', text: current.text });
  if (current?.status === 'hidden') return set(id, { status: 'shown', text: current.text });

  const text = dmTranslatableText(content);
  if (!text) return;
  if (!hasAiConsent() && !(await ensureAiConsent())) return;
  set(id, { status: 'loading' });
  try {
    const result = await translateText(text, getUserLanguage(), 'auto', { isPublic: false });
    if (result.sameLanguage || !result.translatedText?.trim()) {
      set(id, undefined);
      toastSuccess(i18n.t('copy.caac88c81c38', { defaultValue: 'Already in your language' }));
      return;
    }
    set(id, { status: 'shown', text: result.translatedText });
  } catch {
    set(id, undefined);
    toastError(i18n.t('copy.b9725da1e57f', { defaultValue: 'Translation failed. Please try again.' }));
  }
}

const MIN_AUTO_LETTERS = 4;

/**
 * Whether a received message should translate itself. The live chat rule:
 * a script that names itself (Arabic, Cyrillic, kana...) once it has a few
 * letters, and a Latin line only when its own words say it is in another
 * language ("bom dia galera"). Slang and names stay as typed.
 */
export function shouldAutoTranslateDm(content: string | null | undefined, readerLang: string): boolean {
  const text = dmTranslatableText(content).replace(/[@#$][\p{L}\p{N}_.-]+/gu, ' ');
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < MIN_AUTO_LETTERS) return false;
  if (/^[\p{Script=Latin}]*$/u.test(letters)) return chatLineIsForeign(text, readerLang);
  return true;
}

/**
 * Translate a received message without being asked: no toasts, nothing shown
 * unless the text actually changed, and never again for the same message (so
 * "Show original" sticks).
 */
export async function autoTranslateDm(id: string, content?: string | null): Promise<void> {
  if (autoTried.has(id) || entries.has(id)) return;
  if (!hasAiConsent()) return;
  const text = dmTranslatableText(content);
  if (!text) return;
  // Over this hour's budget: leave it untried so it can translate later.
  if (!takeAutoTranslateSlot()) return;
  autoTried.add(id);
  // No 'loading' state: an unasked-for translation shows nothing until it lands.
  try {
    const result = await translateText(text, getUserLanguage(), 'auto', { isPublic: false });
    if (result.sameLanguage || !result.translatedText?.trim() || result.translatedText.trim() === text) return;
    // The reader may have pressed Translate meanwhile; their answer stands.
    if (entries.has(id)) return;
    set(id, { status: 'shown', text: result.translatedText });
  } catch {
    // Quiet: the Translate option in the hold menu is still there.
  }
}

/** Tests only. */
export function __resetDmTranslations() {
  autoTried.clear();
  entries.clear();
  listeners.clear();
}
