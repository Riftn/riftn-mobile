/**
 * Translate one piece of text into the reader's language, only while `on`.
 * Used by the Notifications rows: press and hold a row, tap Translate, and the
 * row and its comment or request read in your language until you tap Show
 * original. Nothing is sent until the reader asks (AI consent is asked by the
 * row before `on` flips).
 */
import { useEffect, useState } from "react";
import { getUserLanguage, translateText } from "../services/translation.service";

export function useOnDemandTranslate(text: string | null | undefined, on: boolean): { text: string; loading: boolean } {
  const original = text ?? "";
  const [translated, setTranslated] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!on || !original.trim()) return;
    if (translated?.from === original) return;
    let alive = true;
    setLoading(true);
    translateText(original, getUserLanguage(), "auto", { isPublic: false })
      .then((r) => { if (alive) setTranslated({ from: original, to: r.translatedText || original }); })
      .catch(() => { if (alive) setTranslated({ from: original, to: original }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [on, original, translated?.from]);

  if (!on || !translated || translated.from !== original) return { text: original, loading: on && loading };
  return { text: translated.to, loading: false };
}
