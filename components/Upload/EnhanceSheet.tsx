import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, ScrollView, TextInput } from "react-native";
import GlassModal from "../ui/GlassModal";
import Icon from "../ui/Icon";
import { AI_STYLE_OPTIONS } from "../../config/ai-styles.constants";
import type { EnhanceMode } from "../../services/ai.service";
import { orderedTranslateLanguages, rememberedTranslateLang, translateLanguageName } from "../../libs/post-translate";

interface EnhanceSheetProps {
  visible: boolean;
  onClose: () => void;
  /** mode is 'style' only when a styleId is supplied. */
  onEnhance: (mode: EnhanceMode, styleId?: string) => void;
  /** Opens the AI assistant so the user can generate copy from scratch. */
  onGenerateContent: () => void;
  /** Translate > language: turns the draft into that language. */
  onTranslate?: (lang: string) => void;
}

/**
 * The post composer's "Enhance" menu — same four entries, same order, as
 * dehubweb's PostActionBar drawer: Spell Check, Fix Grammar, Change Style
 * (drills into the shared style list), Generate Content.
 */
export default function EnhanceSheet({
  visible,
  onClose,
  onEnhance,
  onGenerateContent,
  onTranslate,
}: EnhanceSheetProps) {
  const { t, i18n } = useTranslation();
  const [styleView, setStyleView] = useState(false);
  const [langView, setLangView] = useState(false);
  const [query, setQuery] = useState("");
  const lastLang = rememberedTranslateLang();
  const languages = useMemo(
    () => orderedTranslateLanguages((i18n.language || "en").split("-")[0], lastLang),
    [i18n.language, lastLang],
  );
  const q = query.trim().toLowerCase();
  const shownLanguages = q
    ? languages.filter((l) => l.name.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q) || l.code === q)
    : languages;

  // Always reopen on the root menu, matching web's handleCloseEnhance reset.
  useEffect(() => {
    if (!visible) { setStyleView(false); setLangView(false); setQuery(""); }
  }, [visible]);

  const pickLanguage = useCallback(
    (code: string) => {
      onClose();
      setLangView(false);
      setQuery("");
      onTranslate?.(code);
    },
    [onClose, onTranslate],
  );

  const pick = useCallback(
    (mode: EnhanceMode, styleId?: string) => {
      onClose();
      setStyleView(false);
      onEnhance(mode, styleId);
    },
    [onClose, onEnhance],
  );

  return (
    <GlassModal
      visible={visible}
      onClose={onClose}
      presentation="bottom"
      maxHeight="60%"
      blurIntensity={40}
    >
      <View className="pt-4 pb-2">
        <View className="px-4 pb-3 border-b border-white/10">
          {(styleView || langView) && (
            <TouchableOpacity
              onPress={() => { setStyleView(false); setLangView(false); setQuery(""); }}
              activeOpacity={0.7}
              className="flex-row items-center mb-2"
              accessibilityRole="button"
              accessibilityLabel={t("profile.back")}
            >
              <Icon name="ChevronLeft" size={16} color="#A1A1AA" />
              <Text className="text-theme-neutrals-400 text-sm ml-1">{t("profile.back")}</Text>
            </TouchableOpacity>
          )}
          <View className="flex-row items-center">
            <Icon name={langView ? "Languages" : "Sparkles"} size={20} color="#fff" />
            <Text className="text-white text-base font-semibold ml-2">
              {langView ? t("upload.translateTo") : styleView ? t("upload.chooseStyle") : t("upload.enhance")}
            </Text>
          </View>
          {langView && (
            <View className="mt-3 h-10 flex-row items-center rounded-xl border border-white/15 bg-white/5 px-3">
              <Icon name="Search" size={16} color="#A1A1AA" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("upload.searchLanguages")}
                placeholderTextColor="#A1A1AA"
                accessibilityLabel={t("upload.searchLanguages")}
                autoCorrect={false}
                className="flex-1 ml-2 text-white text-sm"
              />
            </View>
          )}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 16 }}
        >
          {langView ? (
            shownLanguages.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                onPress={() => pickLanguage(lang.code)}
                activeOpacity={0.7}
                className="flex-row items-center justify-between px-4 py-3"
                accessibilityRole="button"
              >
                <View className="flex-row items-baseline flex-shrink">
                  <Text className="text-white text-sm">{lang.nativeName}</Text>
                  {lang.name !== lang.nativeName ? (
                    <Text className="text-theme-neutrals-400 text-xs ml-2" numberOfLines={1}>{lang.name}</Text>
                  ) : null}
                </View>
                {lang.code === lastLang ? <Icon name="Check" size={16} color="#fff" /> : null}
              </TouchableOpacity>
            ))
          ) : styleView ? (
            AI_STYLE_OPTIONS.map((style) => (
              <TouchableOpacity
                key={style.id}
                onPress={() => pick("style", style.id)}
                activeOpacity={0.7}
                className="flex-row items-center px-4 py-3"
              >
                <Text className="text-lg">{style.emoji}</Text>
                <Text className="text-white text-sm ml-3">{t(`aiStyles.${style.id}`)}</Text>
              </TouchableOpacity>
            ))
          ) : (
            <>
              <TouchableOpacity
                onPress={() => pick("spellcheck")}
                activeOpacity={0.7}
                className="flex-row items-center px-4 py-3"
              >
                <Icon name="SpellCheck" size={20} color="#fff" />
                <Text className="text-white text-sm ml-3">{t("upload.spellCheck")}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => pick("grammar")}
                activeOpacity={0.7}
                className="flex-row items-center px-4 py-3"
              >
                <Icon name="Type" size={20} color="#fff" />
                <Text className="text-white text-sm ml-3">{t("upload.fixGrammar")}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setStyleView(true)}
                activeOpacity={0.7}
                className="flex-row items-center justify-between px-4 py-3"
              >
                <View className="flex-row items-center">
                  <Icon name="Palette" size={20} color="#fff" />
                  <Text className="text-white text-sm ml-3">{t("upload.changeStyle")}</Text>
                </View>
                <Icon name="ChevronRight" size={16} color="#6F7174" />
              </TouchableOpacity>

              {onTranslate ? (
                <TouchableOpacity
                  onPress={() => setLangView(true)}
                  activeOpacity={0.7}
                  className="flex-row items-center justify-between px-4 py-3"
                  accessibilityRole="button"
                >
                  <View className="flex-row items-center">
                    <Icon name="Languages" size={20} color="#fff" />
                    <Text className="text-white text-sm ml-3">{t("upload.translate")}</Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text className="text-theme-neutrals-400 text-xs mr-2">{translateLanguageName(lastLang) ?? "English"}</Text>
                    <Icon name="ChevronRight" size={16} color="#6F7174" />
                  </View>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={() => {
                  onClose();
                  setStyleView(false);
                  onGenerateContent();
                }}
                activeOpacity={0.7}
                className="flex-row items-center px-4 py-3"
              >
                <Icon name="MessageSquare" size={20} color="#fff" />
                <Text className="text-white text-sm ml-3">{t("upload.generateContent")}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </GlassModal>
  );
}
