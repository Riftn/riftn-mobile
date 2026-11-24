import React from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useCall } from "../../context/CallContext";
import { useAuth } from "../../context/AuthContext";
import { useGroupCallRoster } from "../../libs/groupCall";

/**
 * Voice and video call buttons for a group, and a "Join call" pill in their
 * place while one is going. Starting rings every member; joining just steps
 * into the room.
 */
/**
 * `ring={false}` is an open room (Public Chat): starting opens the room
 * without ringing anyone, and others join from the pill.
 */
/** `joinOnly`: just the "Join call" pill while a call is on, nothing
 *  otherwise (Public Chat starts calls from its + menu). */
const GroupCallButtons: React.FC<{ groupId: string; groupName: string; members: string[]; canStart?: boolean; ring?: boolean; joinOnly?: boolean }> = ({ groupId, groupName, members, canStart = true, ring = true, joinOnly = false }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { startGroupCall, joinGroupCall, currentCall } = useCall();
  const roster = useGroupCallRoster(groupId);
  const me = (user?.walletAddress || user?.address || "").toLowerCase();
  const others = roster.filter((entry) => entry.wallet !== me);
  const busy = !!currentCall;
  const group = { id: groupId, name: groupName };

  if (others.length && currentCall?.group_id !== groupId) {
    const callType = others.some((entry) => entry.type === "video") ? "video" : "audio";
    return (
      <Pressable
        onPress={() => { void joinGroupCall(group, callType); }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("calls.joinCall", { defaultValue: "Join call" })}
        style={({ pressed }) => [styles.join, (pressed || busy) && styles.dim]}
      >
        <Icon name={callType === "video" ? "Video" : "Phone"} size={14} color="#0A0A0C" />
        <Text style={styles.joinText} numberOfLines={1}>
          {t("calls.joinCall", { defaultValue: "Join call" })} · {others.length}
        </Text>
      </Pressable>
    );
  }

  // Who may ring the group is a group setting (Permissions > Start group
  // calls); the database refuses the ring otherwise.
  if (!canStart || joinOnly) return null;

  return (
    <View style={styles.row}>
      {(["audio", "video"] as const).map((callType) => (
        <TouchableOpacity
          key={callType}
          onPress={() => { void (ring ? startGroupCall(group, members, callType) : joinGroupCall(group, callType)); }}
          disabled={busy || (ring && members.length < 2)}
          style={[styles.btn, (busy || (ring && members.length < 2)) && styles.dim]}
          activeOpacity={0.6}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={callType === "video"
            ? t("calls.startGroupVideo", { defaultValue: "Start a group video call" })
            : t("calls.startGroupVoice", { defaultValue: "Start a group voice call" })}
        >
          <Icon name={callType === "video" ? "Video" : "Phone"} size={18} color="#FFFFFF" />
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  btn: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dim: { opacity: 0.4 },
  join: {
    flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12,
    borderRadius: 999, backgroundColor: "#F4F4F5",
  },
  joinText: { color: "#0A0A0C", fontSize: 13, fontWeight: "700" },
});

export default GroupCallButtons;
