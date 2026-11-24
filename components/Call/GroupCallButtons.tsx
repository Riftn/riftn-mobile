import React from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useCall } from "../../context/CallContext";
import { useAuth } from "../../context/AuthContext";
import { useGroupCallRoster, groupCallLoad } from "../../libs/groupCall";
import { formatCount } from "../../libs/format-count";

/**
 * Voice and video call buttons for a group, and a "Join call" pill in their
 * place while one is going. Starting opens the room without ringing or
 * notifying anyone; members join from the pill. A room at its limit shows
 * "Full" instead.
 */
/** `joinOnly`: just the "Join call" pill while a call is on, nothing
 *  otherwise (Public Chat starts calls from its + menu). */
const GroupCallButtons: React.FC<{ groupId: string; groupName: string; canStart?: boolean; joinOnly?: boolean }> = ({ groupId, groupName, canStart = true, joinOnly = false }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { joinGroupCall, currentCall } = useCall();
  const roster = useGroupCallRoster(groupId);
  const [starting, setStarting] = React.useState(false);
  const me = (user?.walletAddress || user?.address || "").toLowerCase();
  const others = roster.filter((entry) => entry.wallet !== me);
  const { full } = groupCallLoad(roster, me);
  const busy = !!currentCall || starting;
  const open = async (callType: "audio" | "video") => {
    if (busy) return;
    setStarting(true);
    try { await joinGroupCall({ id: groupId, name: groupName }, callType); } finally { setStarting(false); }
  };

  if (others.length && currentCall?.group_id !== groupId) {
    const callType = others.some((entry) => entry.type === "video") ? "video" : "audio";
    const label = full ? t("calls.callFull", { defaultValue: "Call full" }) : t("calls.joinCall", { defaultValue: "Join call" });
    return (
      <Pressable
        onPress={() => { void open(callType); }}
        disabled={busy || full}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || full }}
        accessibilityLabel={`${label} · ${formatCount(others.length)}`}
        style={({ pressed }) => [styles.join, full && styles.joinFull, (pressed || busy) && styles.dim]}
      >
        {/* Just the icon and how many are in (or "Full"), so the pill never
            squeezes the chat name or the buttons beside it on a phone header. */}
        <Icon name={full ? "Users" : callType === "video" ? "Video" : "Phone"} size={14} color={full ? "#FFFFFF" : "#0A0A0C"} />
        <Text style={[styles.joinText, full && styles.joinTextFull]} numberOfLines={1}>
          {full ? t("calls.full", { defaultValue: "Full" }) : formatCount(others.length)}
        </Text>
      </Pressable>
    );
  }

  // Who may start a call is a group setting (Permissions > Start group calls).
  if (!canStart || joinOnly) return null;

  return (
    <View style={styles.row}>
      {(["audio", "video"] as const).map((callType) => (
        <TouchableOpacity
          key={callType}
          onPress={() => { void open(callType); }}
          disabled={busy}
          style={[styles.btn, busy && styles.dim]}
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
    flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 11, flexShrink: 0,
    borderRadius: 999, backgroundColor: "#F4F4F5",
  },
  joinText: { color: "#0A0A0C", fontSize: 13, fontWeight: "700" },
  joinFull: { backgroundColor: "rgba(255,255,255,0.14)" },
  joinTextFull: { color: "#FFFFFF" },
});

export default GroupCallButtons;
