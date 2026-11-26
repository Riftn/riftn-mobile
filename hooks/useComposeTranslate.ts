import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { translateText } from "../services/translation.service";
import { ensureAiConsent } from "../libs/ai-consent";
import { toastError, toastInfo } from "../libs/toast";
import { haptic } from "../libs/haptics";
import { SUPPORTED_LANGUAGES } from "../i18n";

/** Same key web uses (lib/compose-translate), so the pick is one setting. */
const KEY = "riftn.chat.translateTo";
let target: string | null = null;
const listeners = new Set<(code: string) => void>();
AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v && target === null) {
      target = v;
      listeners.forEach((l) => l(v));
    }
  })
  .catch(() => {});

export function languageLabel(code: string): string {
  const info = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return info?.nativeName ?? code.toUpperCase();
}

/**
 * The chat composer's Translate button: rewrites what is typed into the
 * chosen language before it is sent. Uses the composer default until the user picks another
 * (long press, or "Translate to…" in the + sheet); the pick is remembered.
 */
export function useComposeTranslate(text: string, setText: (v: string) => void, defaultLang = "en") {
  const { t } = useTranslation();
  const [savedLang, setLang] = useState(target);
  const lang = savedLang ?? defaultLang;
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    setLang(target);
    listeners.add(setLang);
    return () => {
      mounted.current = false;
      listeners.delete(setLang);
    };
  }, []);

  const translate = useCallback(
    async (code: string = target ?? defaultLang) => {
      const draft = text.trim();
      if (!draft || busy) return;
      if (!(await ensureAiConsent())) return;
      haptic.tap();
      setBusy(true);
      try {
        const res = await translateText(draft, code, "auto", { isChat: true });
        if (res.sameLanguage || !res.translatedText || res.translatedText.trim() === draft) {
          // Already in that language: say which, so the tap visibly did something.
          toastInfo(`${t("common.translate")} · ${languageLabel(code)} ✓`);
        } else {
          if (mounted.current) setText(res.translatedText);
        }
      } catch {
        toastError(t("copy.b9725da1e57f"));
      } finally {
        setBusy(false);
      }
    },
    [text, busy, setText, t, defaultLang],
  );

  const choose = useCallback(
    (code: string) => {
      target = code;
      AsyncStorage.setItem(KEY, code).catch(() => {});
      listeners.forEach((l) => l(code));
      void translate(code);
    },
    [translate],
  );

  return {
    lang,
    busy,
    translate,
    choose,
    pickerOpen,
    openPicker: useCallback(() => setPickerOpen(true), []),
    closePicker: useCallback(() => setPickerOpen(false), []),
  };
}
