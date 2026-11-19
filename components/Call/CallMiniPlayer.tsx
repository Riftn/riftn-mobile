import MessageSurface from "../DM/MessageSurface";
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Avatar from "../common/Avatar";
import Icon from "../ui/Icon";
import { radius } from "../../theme/radius";
import { useCall } from "../../context/CallContext";
import { CallDuration } from "./CallDuration";
import { CallWave } from "./CallChrome";
import { usePeerIdentity } from "./usePeerIdentity";

/**
 * The call, folded down to a pill while the rest of the app is in use: who it
 * is with, how long it has run, and the two things worth reaching for without
 * opening it again: mute and hang up. Tapping the name brings the stage back.
 *
 * Written in the dark greys the rest of the app uses, so System Light turns it
 * around with everything else.
 */
const CallMiniPlayer: React.FC = () => {
  const {
    isCallActive, isConnecting, isRinging, isMinimized, isMuted, peerAddress,
    endCall, toggleMute, setMinimized, currentCall,
  } = useCall();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const peer = usePeerIdentity(peerAddress);

  if (!isMinimized || (!isCallActive && !isConnecting)) return null;

  const fallback = isRinging ? t("calls.calling") : t("calls.connecting");
  // A group call folds to its name.
  const isGroup = !!currentCall?.group_id;
  const name = isGroup ? currentCall?.group_name || peer.name : peer.name;

  return (
    <View style={[styles.container, { bottom: Math.max(80, insets.bottom + 64) }]}>
      <MessageSurface radius={24} />
      <Pressable
        style={styles.who}
        onPress={() => setMinimized(false)}
        accessibilityRole="button"
        accessibilityLabel={t("calls.expand")}
      >
        <Avatar uri={isGroup ? null : peer.avatarUrl} size={36} radius={10} name={name} />
        <View style={styles.text}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.time} numberOfLines={1}><CallDuration fallback={fallback} /></Text>
        </View>
        {isCallActive ? <CallWave paused={isMuted} height={16} color="#F4F4F5" /> : null}
      </Pressable>
      <Pressable
        onPress={toggleMute}
        style={[styles.button, isMuted && styles.buttonSolid]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={isMuted ? t("calls.unmute") : t("calls.mute")}
        accessibilityState={{ selected: isMuted }}
      >
        <Icon name={isMuted ? "MicOff" : "Mic"} size={17} color={isMuted ? "#0A0A0C" : "#F4F4F5"} />
      </Pressable>
      <Pressable
        onPress={endCall}
        style={[styles.button, styles.buttonSolid]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={isGroup ? t("calls.leave", { defaultValue: "Leave" }) : t("calls.end")}
      >
        <Icon name="PhoneOff" size={17} color="#0A0A0C" />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 54,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#1D1F21",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    zIndex: 100,
  },
  who: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  text: {
    flex: 1,
  },
  name: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  time: {
    color: "#A1A1AA",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  button: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSolid: {
    backgroundColor: "#F4F4F5",
  },
});

export default CallMiniPlayer;
