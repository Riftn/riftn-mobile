/**
 * The chat for a cleared (expanded) live screen, like YouTube's: a round chat
 * button above the rotate button opens the room as a column, down the right
 * in landscape and along the bottom in portrait. "Say something" brings the
 * full screen back with its message box.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "../ui/Icon";
import LiveViewerChat, { type ChatActivity } from "./LiveViewerChat";

export default function LiveClearedChat({
  activities,
  myAddress,
  landscape,
  onSay,
}: {
  activities: ChatActivity[];
  myAddress?: string | null;
  landscape: boolean;
  onSay: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const right = Math.max(insets.right, 12) + 4;
  const bottom = Math.max(insets.bottom, 12) + 4;
  return (
    <>
      {open ? (
        <View
          testID="live-cleared-chat"
          pointerEvents="box-none"
          style={[
            styles.panel,
            landscape
              ? { right: right + 52, top: Math.max(insets.top, 12), bottom, width: "38%" }
              : { left: Math.max(insets.left, 12), right: right + 52, bottom },
          ]}
        >
          <LiveViewerChat activities={activities} myAddress={myAddress ?? undefined} />
          <Pressable accessibilityRole="button" onPress={onSay} style={styles.say}>
            <Text style={styles.sayText} numberOfLines={1}>{t("liveViewer.saySomething")}</Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable
        testID="live-cleared-chat-toggle"
        accessibilityRole="button"
        accessibilityState={{ selected: open }}
        accessibilityLabel={open ? t("liveViewer.hideChat") : t("liveViewer.showChat")}
        onPress={() => setOpen((v) => !v)}
        hitSlop={10}
        style={[styles.button, open && styles.buttonOn, { right, bottom: bottom + 52 }]}
      >
        <Icon name="MessageSquare" size={18} color="#fff" />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    justifyContent: "flex-end",
  },
  say: {
    marginTop: 8,
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
  },
  sayText: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  button: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
  },
  buttonOn: { backgroundColor: "rgba(255,255,255,0.25)" },
});
