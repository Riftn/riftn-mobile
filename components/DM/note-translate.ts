/**
 * A note's words in the reader's language. Same as web's
 * components/app/chat/note-translate.
 *
 * A note that reads as another language (judged on the device, the same way a
 * Moment caption is) is translated as soon as it shows, through the same cached
 * translate path Moments and posts use. One shared answer per note feeds every
 * place it appears (the Status row, chat tags, the open note), so a screen
 * costs one request per note at most. The open note offers "See original".
 *
 * Your own note is never translated. Nothing is sent on its own when
 * auto-translate is off or AI use hasn't been allowed (autoTranslateEnabled
 * checks both): the open note then offers Translate, which asks first.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getUserLanguage, translateText } from "../../services/translation.service";
import { autoTranslateEnabled, subscribeAutoTranslate } from "../../libs/auto-translate-setting";
import { ensureAiConsent, subscribeAiConsent } from "../../libs/ai-consent";
import { momentTextLooksForeign } from "../Stories/story-translate";

/** loading, the translation, null when it is already in the reader's language, or failed. */
type Answer = { state: "loading" } | { state: "done"; text: string | null } | { state: "failed" };

const answers = new Map<string, Answer>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const keyOf = (text: string, lang: string) => `${lang}\n${text}`;

function ask(text: string, lang: string): void {
  const key = keyOf(text, lang);
  const known = answers.get(key);
  if (known && known.state !== "failed") return;
  answers.set(key, { state: "loading" });
  emit();
  // Notes reach followers only, so the text stays away from providers that train.
  translateText(text, lang, "auto", { isPublic: false })
    .then((r) => answers.set(key, { state: "done", text: r.sameLanguage ? null : r.translatedText }))
    .catch(() => answers.set(key, { state: "failed" }))
    .finally(emit);
}

/** Exported for tests. */
export function resetNoteTranslations(): void {
  answers.clear();
  emit();
}

const subscribeAuto = (l: () => void) => {
  const a = subscribeAutoTranslate(l);
  const b = subscribeAiConsent(l);
  return () => {
    a();
    b();
  };
};

export function useNoteWords(text: string | null | undefined, own = false) {
  const words = text ?? "";
  const { i18n } = useTranslation();
  const lang = useMemo(() => getUserLanguage(), [i18n.language]);
  const auto = useSyncExternalStore(subscribeAuto, autoTranslateEnabled);
  useSyncExternalStore(subscribe, () => version);
  const foreign = useMemo(() => !own && !!words.trim() && momentTextLooksForeign(words, lang), [own, words, lang]);
  const answer = foreign ? answers.get(keyOf(words, lang)) : undefined;
  const [original, setOriginal] = useState(false);

  useEffect(() => {
    if (foreign && auto) ask(words, lang);
  }, [foreign, auto, words, lang]);
  useEffect(() => setOriginal(false), [words, lang]);

  const ready = answer?.state === "done" ? answer.text : null;
  const isTranslated = ready != null && !original;

  const translate = useCallback(async () => {
    setOriginal(false);
    if (!(await ensureAiConsent())) return;
    ask(words, lang);
  }, [words, lang]);
  const showOriginal = useCallback(() => setOriginal(true), []);

  return {
    /** What to draw: the translation once there is one, else the note as written. */
    shown: isTranslated ? ready : words,
    isTranslated,
    isLoading: answer?.state === "loading",
    /** Whether the open note should offer Translate / See original. */
    offer: foreign && !(answer?.state === "done" && answer.text == null),
    translate,
    showOriginal,
  };
}
