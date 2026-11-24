import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Avatar from "../common/Avatar";
import Icon from "../ui/Icon";
import type { GroupParticipant } from "../../hooks/useCall";
import type { CallModAction } from "../../libs/groupCallModeration";
import { usePeerIdentity } from "./usePeerIdentity";

/** The ⋯ button the chat's moderators get on a person in a group call. */
export function CallModButton({ onPress, label, top = 12, right = 12, size = 32 }: { onPress: () => void; label: string; top?: number; right?: number; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.more, { top, right, width: size, height: size }]}
    >
      <Icon name="MoreHorizontal" size={16} color="#FFFFFF" />
    </Pressable>
  );
}

/**
 * Moderator menu for one person in a group call: mute or unmute them for
 * everyone, or remove them from the call. Drawn inside the call screen.
 */
export function CallModSheet({ participant, top, bottom, onPick, onClose }: {
  participant: GroupParticipant;
  /** Where the card sits. Kept clear of camera tiles that draw over everything on Android. */
  top?: number;
  bottom?: number;
  onPick: (action: CallModAction) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const peer = usePeerIdentity(participant.wallet ?? "");
  const name = participant.wallet ? peer.name : "…";
  const muted = !!participant.modMuted;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.cancel", { defaultValue: "Cancel" })} />
      <View style={[styles.card, top != null ? { top } : { bottom: bottom ?? 16 }]}>
        <View style={styles.head}>
          <Avatar uri={peer.avatarUrl} size={36} radius={10} name={name.replace(/^@/, "")} />
          <Text style={[styles.headName, { color: "#FFFFFF" }]} numberOfLines={1}>{name}</Text>
        </View>
        <Pressable style={styles.row} onPress={() => onPick(muted ? "unmute" : "mute")} accessibilityRole="button">
          <Icon name={muted ? "Mic" : "MicOff"} size={18} color="#FFFFFF" />
          <Text style={[styles.rowText, { color: "#FFFFFF" }]}>
            {muted ? t("calls.modUnmute", { name, defaultValue: "Unmute {{name}}" }) : t("calls.modMute", { name, defaultValue: "Mute {{name}}" })}
          </Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => onPick("remove")} accessibilityRole="button">
          <Icon name="UserMinus" size={18} color="#FF6B6B" />
          <Text style={[styles.rowText, { color: "#FF6B6B" }]}>{t("calls.modRemove", { defaultValue: "Remove from call" })}</Text>
        </Pressable>
        <Pressable style={[styles.row, styles.cancel]} onPress={onClose} accessibilityRole="button">
          <Text style={[styles.cancelText, { color: "#FFFFFF" }]}>{t("common.cancel", { defaultValue: "Cancel" })}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  more: {
    position: "absolute", zIndex: 3, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(18,18,22,0.6)",
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  card: {
    position: "absolute", left: 12, right: 12, borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", overflow: "hidden",
    paddingVertical: 6, backgroundColor: "rgba(22,22,26,0.97)",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 12 },
  headName: { flexShrink: 1, fontSize: 16, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
  rowText: { fontSize: 15.5, fontWeight: "700" },
  cancel: { justifyContent: "center" },
  cancelText: { fontSize: 15, fontWeight: "600", opacity: 0.8 },
});
