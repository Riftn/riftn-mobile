/**
 * MessageRequestBar — shown above a thread that is still a message request:
 * a first message from someone you don't follow. Accept moves the chat to the
 * inbox (so does replying or following them); Delete and Block get rid of it.
 * Same rules and copy as the web MessageRequestBar.
 */
import React, { memo } from "react";
import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../context/ThemeContext";

interface Props {
  name: string;
  busy?: boolean;
  onAccept: () => void;
  onDelete: () => void;
  onBlock: () => void;
}

const MessageRequestBarComponent: React.FC<Props> = ({ name, busy, onAccept, onDelete, onBlock }) => {
  const { t } = useTranslation();
  const { isLight } = useAppTheme();
  const tone = isLight
    ? { bg: "rgba(0,0,0,0.04)", border: "rgba(0,0,0,0.12)", text: "#3F3F46", solid: "#0B0B0C", solidInk: "#FFFFFF", ink: "#0B0B0C" }
    : { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)", text: "#D4D4D8", solid: "#FFFFFF", solidInk: "#0B0B0C", ink: "#FFFFFF" };

  const button = (label: string, onPress: () => void, solid: boolean, testID: string, disabled?: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}
    >
      {/* The fill sits on an inner View so themed Pressable repaints leave it alone. */}
      <View
        style={{
          minHeight: 36,
          paddingHorizontal: 16,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: solid ? tone.solid : "transparent",
          borderWidth: solid ? 0 : 1,
          borderColor: tone.border,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: "600", color: solid ? tone.solidInk : tone.ink }}>{label}</Text>
      </View>
    </Pressable>
  );

  return (
    <View
      testID="message-request-bar"
      style={{
        marginHorizontal: 12,
        marginTop: 8,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        backgroundColor: tone.bg,
        borderColor: tone.border,
      }}
    >
      <Text style={{ fontSize: 13, lineHeight: 18, color: tone.text }}>
        {t("dmRequests.banner", {
          defaultValue: "You don't follow {{name}}. Accept to move this chat to your inbox, or just reply.",
          name,
        })}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {button(t("dmRequests.accept", { defaultValue: "Accept" }), onAccept, true, "request-accept", busy)}
        {button(t("dmRequests.delete", { defaultValue: "Delete" }), onDelete, false, "request-delete")}
        {button(t("dmRequests.block", { defaultValue: "Block" }), onBlock, false, "request-block")}
      </View>
    </View>
  );
};

export default memo(MessageRequestBarComponent);
