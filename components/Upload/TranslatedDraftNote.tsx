import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";

/** Under the draft after AI menu > Translate: where it came from, and a way back. */
export function TranslatedDraftNote({ fromName, onUndo }: { fromName: string | null; onUndo: () => void }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center flex-shrink mr-auto pr-2">
      <Icon name="Languages" size={14} color="#a1a1aa" />
      <Text className="text-theme-neutrals-400 text-xs ml-1.5 flex-shrink" numberOfLines={1}>
        {fromName ? t("upload.translatedFrom", { language: fromName }) : t("upload.translated")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onUndo}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
        className="ml-2"
      >
        <Text className="text-white text-xs font-semibold underline">{t("upload.undoTranslate")}</Text>
      </Pressable>
    </View>
  );
}
