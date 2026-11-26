import React, { type ReactNode, type RefObject, useState } from "react";
import { Pressable, Text, View, type TextInput, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { BoldText } from "../../libs/bold-markup";
import { postTextRuns, togglePostTextStyle, type PostTextSelection, type PostTextStyle } from "../../libs/post-text-format";

export function postRunStyle(styles: readonly PostTextStyle[]): TextStyle {
  return {
    fontWeight: styles.includes("b") ? "700" : undefined,
    fontStyle: styles.includes("i") ? "italic" : undefined,
    textDecorationLine: styles.includes("u") ? "underline" : undefined,
  };
}

export function PostStyledText({ text }: { text?: string | null }) {
  if (!text) return null;
  return <>{postTextRuns(text).map((run, index) => {
    const content: ReactNode = <BoldText text={run.text} />;
    return run.styles.length
      ? <Text key={index} style={postRunStyle(run.styles)}>{content}</Text>
      : <React.Fragment key={index}>{content}</React.Fragment>;
  })}</>;
}

interface PostFormatControlsProps {
  value: string;
  inputRef: RefObject<TextInput | null>;
  selectionRef: RefObject<PostTextSelection>;
  maxLength: number;
  onChangeText: (text: string) => void;
}

export function PostFormatControls({ value, inputRef, selectionRef, maxLength, onChangeText }: PostFormatControlsProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(false);
  const hasFormatting = postTextRuns(value).some(run => run.styles.length > 0);
  const buttons = [
    { style: "b", label: t("editor.layer.bold"), letter: "B" },
    { style: "i", label: t("editor.layer.italic"), letter: "I" },
    { style: "u", label: t("editor.layer.underline"), letter: "U" },
  ] as const;
  const apply = (style: PostTextStyle) => {
    const next = togglePostTextStyle(value, selectionRef.current, style, maxLength);
    if (!next) return;
    selectionRef.current = next.selection;
    onChangeText(next.text);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps({ selection: next.selection });
    });
  };
  return (
    <View>
      <View className="flex-row items-center gap-1">
        {buttons.map(({ style, label, letter }) => (
          <Pressable key={style} accessibilityRole="button" accessibilityLabel={label}
            className="h-11 w-10 items-center justify-center rounded-lg" onPress={() => apply(style)}>
            <Text className="text-theme-neutrals-200 text-base" style={postRunStyle([style])}>{letter}</Text>
          </Pressable>
        ))}
        {hasFormatting && (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: preview }}
            className="h-11 justify-center rounded-lg px-3" onPress={() => setPreview(open => !open)}>
            <Text className="text-theme-neutrals-300 text-sm">{t("articles.preview", { defaultValue: "Preview" })}</Text>
          </Pressable>
        )}
      </View>
      {preview && hasFormatting && (
        <Text className="text-theme-neutrals-100 my-2"><PostStyledText text={value} /></Text>
      )}
    </View>
  );
}
