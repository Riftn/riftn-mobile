import { useMemo } from 'react';
import { useTranslation } from './useTranslation';

/**
 * A poll's question and options in the reader's language.
 *
 * The question and every option go to the translator as one text, one per
 * line, so short options ("Evet", "Hayır") are translated with the question
 * around them instead of being too short to auto-translate on their own, and a
 * poll costs one call, not one per option. If the lines do not come back one
 * for one, the poll stays as written rather than pairing an answer with the
 * wrong option.
 *
 * Off for private polls (direct messages): those are not ours to send to a
 * translator unasked.
 */
export function usePollTranslation(
  tokenId: number,
  question: string | undefined,
  options: { index: number; text: string }[] | undefined,
  enabled: boolean,
) {
  const lines = useMemo(
    () => (question || options?.length ? [question ?? '', ...(options ?? []).map(o => o.text)] : []),
    [question, options],
  );
  const texts = useMemo(
    () => ({ poll: enabled && lines.length > 1 ? lines.map(l => l.replace(/\s+/g, ' ').trim()).join('\n') : '' }),
    [enabled, lines],
  );
  const { isTranslated, translatedTexts } = useTranslation(texts, null, enabled, true, `poll-${tokenId}`);

  return useMemo(() => {
    const translated = translatedTexts.poll;
    if (!isTranslated || !translated) return null;
    const out = translated.split('\n').map(l => l.trim()).filter(Boolean);
    if (out.length !== lines.filter(l => l.trim()).length) return null;
    let i = 0;
    const q = question?.trim() ? out[i++] : question ?? '';
    const byIndex = new Map<number, string>();
    for (const o of options ?? []) byIndex.set(o.index, o.text.trim() ? out[i++] : o.text);
    return { question: q, option: (index: number, fallback: string) => byIndex.get(index) ?? fallback };
  }, [isTranslated, translatedTexts, lines, question, options]);
}
