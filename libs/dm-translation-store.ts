import { useCallback, useSyncExternalStore } from 'react';
import i18n from 'i18next';
import { translateText, getUserLanguage } from '../services/translation.service';
import { parseMomentReply } from './moment-reply';
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
  return (parseMomentReply(content)?.text ?? content ?? '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
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

/**
 * A line sent with "Send in their language" carries both versions, so its
 * "translation" is the other version and flipping needs no translator call.
 * Seeds the store quietly (it runs while the bubble renders) and keeps the
 * reader's current side when an edit changes the text.
 */
export function primeDmPair(id: string, other: string): void {
  const cur = entries.get(id);
  autoTried.add(id);
  if (cur && cur.status !== 'loading' && cur.text === other) return;
  entries.set(id, { status: cur?.status === 'shown' ? 'shown' : 'hidden', text: other });
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
      if (result.untranslated) toastError(i18n.t('copy.noTranslationFound', { defaultValue: "Couldn't translate this one. It may be slang or a name." }));
      else toastSuccess(i18n.t('copy.caac88c81c38', { defaultValue: 'Already in your language' }));
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

/** At most this many follow-on translations in flight from one tap (web's TRANSLATE_UP_CONCURRENCY). */
const TRANSLATE_ABOVE_CONCURRENCY = 3;
/** The most earlier messages one tap asks for, so a long chat never fires hundreds of requests. */
const TRANSLATE_ABOVE_LIMIT = 100;

/** One earlier message, translated without a spinner or toast; a failure leaves it as typed. */
async function translateDmQuietly(id: string, content?: string | null): Promise<void> {
  if (entries.has(id)) return;
  const text = dmTranslatableText(content);
  if (!text) return;
  try {
    const result = await translateText(text, getUserLanguage(), 'auto', { isPublic: false });
    if (result.sameLanguage || !result.translatedText?.trim() || result.translatedText.trim() === text) return;
    // The reader may have translated it themselves meanwhile; their answer stands.
    if (entries.has(id)) return;
    set(id, { status: 'shown', text: result.translatedText });
  } catch {
    // Quiet: Translate in the hold menu is still there for this one.
  }
}

/**
 * "Translate" on one message translates every message above it too, the same
 * as web (hooks/use-translate-up). The tapped message goes straight away with
 * its usual spinner and toasts; the earlier ones follow quietly, nearest
 * first, a few at a time. `earlier` is the other person's messages sent before
 * the tapped one, in any order.
 */
export async function translateDmAndAbove(
  id: string,
  content: string | null | undefined,
  earlier: ReadonlyArray<{ id: string; content?: string | null; at: number }>,
): Promise<void> {
  if (!hasAiConsent() && !(await ensureAiConsent())) return;
  const tapped = toggleDmTranslation(id, content);
  const queue = earlier
    .filter((line) => line.id && line.id !== id && !entries.has(line.id) && canTranslateDm(line.content))
    .sort((a, b) => b.at - a.at)
    .slice(0, TRANSLATE_ABOVE_LIMIT);
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await translateDmQuietly(next.id, next.content);
    }
  };
  await Promise.all([tapped, ...Array.from({ length: TRANSLATE_ABOVE_CONCURRENCY }, worker)]);
}

/** Tests only. */
export function __resetDmTranslations() {
  autoTried.clear();
  entries.clear();
  listeners.clear();
}
