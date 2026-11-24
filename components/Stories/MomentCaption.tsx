/**
 * A Moment's caption, with a Translate chip when it reads as another language
 * than the viewer's. Tap to read it in your language, tap again to see the
 * original. Port of web's `components/app/stories/MomentCaption`.
 *
 * Nothing is sent until the chip is tapped (and AI use is allowed), and the
 * answer comes from the same cached translate path posts use, so flipping back
 * and forth costs one request at most. Mounted per Moment (keyed by id), so a
 * translation never carries over to the next one.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import Icon from "../ui/Icon";
import { ChromeFill, CHROME_HAIRLINE } from "../common/ViewerChrome";
import { getUserLanguage, translateText } from "../../services/translation.service";
import { ensureAiConsent } from "../../libs/ai-consent";
import { toastError, toastSuccess } from "../../libs/toast";
import { momentTextLooksForeign } from "./story-translate";
import { TEXT_SHADOW } from "./StoryRoom";
import { BoldText } from "../../libs/bold-markup";

export default function MomentCaption({ text, publicContent }: { text: string; publicContent: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = useMemo(() => getUserLanguage(), [i18n.language]);
  const foreign = useMemo(() => momentTextLooksForeign(text, lang), [text, lang]);
  const [translation, setTranslation] = useState<{ lang: string; text: string } | null>(null);
  const [showing, setShowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [same, setSame] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const ready = translation?.lang === lang ? translation.text : null;
  const translated = showing && ready != null;

  const onChip = async () => {
    if (loading) return;
    if (translated) { setShowing(false); return; }
    if (ready != null) { setShowing(true); return; }
    if (!(await ensureAiConsent()) || !alive.current) return;
    setLoading(true);
    try {
      const r = await translateText(text, lang, "auto", { isPublic: publicContent });
      if (!alive.current) return;
      if (r.sameLanguage) {
        setSame(true);
        if (r.untranslated) toastError(t("stories.couldNotTranslate", { defaultValue: "Couldn't translate this one. It may be slang or a name." }));
        else toastSuccess(t("stories.alreadyYourLanguage", { defaultValue: "Already in your language" }));
        return;
      }
      setTranslation({ lang, text: r.translatedText });
      setShowing(true);
    } catch {
      if (alive.current) toastError(t("stories.translateFailed", { defaultValue: "Couldn't translate right now. Try again." }));
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  const label = loading
    ? t("stories.translating", { defaultValue: "Translating…" })
    : translated
      ? t("stories.seeOriginal", { defaultValue: "See original" })
      : t("stories.translate", { defaultValue: "Translate" });

  return (
    <>
      <Text style={styles.caption} numberOfLines={3}>
        <BoldText text={translated ? ready : text} />
      </Text>
      {foreign && !same ? (
        <Pressable
          onPress={() => void onChip()}
          disabled={loading}
          style={styles.chip}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <ChromeFill glass radius={13} />
          <View pointerEvents="none" style={styles.chipInner}>
            {loading ? <ActivityIndicator size="small" color="#fff" style={styles.spinner} /> : <Icon name="Languages" size={14} color="#fff" />}
            <Text style={styles.chipText}>{label}</Text>
          </View>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  caption: { color: "#fff", fontSize: 15, fontWeight: "600", lineHeight: 20, ...TEXT_SHADOW },
  chip: {
    marginTop: 6,
    height: 26,
    borderRadius: 13,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: CHROME_HAIRLINE,
    justifyContent: "center",
  },
  chipInner: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10 },
  spinner: { width: 14, height: 14, transform: [{ scale: 0.7 }] },
  chipText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
