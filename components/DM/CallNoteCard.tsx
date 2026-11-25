import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useCall } from "../../context/CallContext";
import { describeCallNote } from "../../libs/callNote";

/**
 * A call in the thread: what happened, how long it ran, and a button that
 * calls the same person back the same way. The note that a call *started* is
 * only a quiet line, since the card for how it finished follows it.
 */
const CallNoteCard: React.FC<{
  content: string;
  time: string;
  isMine: boolean;
  /** The other person in a one-to-one chat; no button without it. */
  peerAddress?: string;
}> = ({ content, time, isMine, peerAddress }) => {
  const { t } = useTranslation();
  const { startCall, currentCall } = useCall();
  const note = describeCallNote(content);
  const kind = note.video ? t("calls.videoCallShort") : t("calls.voiceCallShort");
  const icon = note.video ? "Video" : "Phone";

  if (note.kind === "started") {
    return (
      <View style={styles.quiet}>
        <Icon name={icon} size={12} color="#8E8E96" />
        <Text style={styles.quietText}>{kind} · {time}</Text>
      </View>
    );
  }

  const title = note.kind === "ended"
    ? t("calls.ended")
    : note.kind === "declined"
      ? t("calls.declined")
      : isMine ? t("calls.noAnswer") : t("calls.missed");
  const sub = note.kind === "ended" ? [note.duration, time].filter(Boolean).join(" · ") : `${kind} · ${time}`;
  // A call someone else missed or one that simply ended does not need shouting about.
  const quietButton = note.kind === "ended" || isMine;
  const busy = !!currentCall;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Icon name={note.kind === "ended" ? icon : "PhoneOff"} size={16} color="#F4F4F5" />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
        </View>
        {peerAddress ? (
          <Pressable
            onPress={() => { void startCall(peerAddress, note.video ? "video" : "audio"); }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("calls.callBack")}
            accessibilityState={{ disabled: busy }}
            hitSlop={6}
            style={({ pressed }) => [styles.go, quietButton && styles.goQuiet, (busy || pressed) && styles.goDim]}
          >
            <Text style={[styles.goText, quietButton && styles.goTextQuiet]} numberOfLines={1}>{t("calls.callBack")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  quiet: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
  },
  quietText: {
    color: "#8E8E96",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  wrap: {
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: "100%",
    maxWidth: 300,
    paddingVertical: 9,
    paddingLeft: 11,
    paddingRight: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  text: {
    flex: 1,
  },
  title: {
    color: "#F4F4F5",
    fontSize: 14,
    fontWeight: "700",
  },
  sub: {
    color: "#A1A1AA",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  go: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F4F5",
  },
  goQuiet: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  goDim: {
    opacity: 0.5,
  },
  goText: {
    color: "#0A0A0C",
    fontSize: 12.5,
    fontWeight: "700",
  },
  goTextQuiet: {
    color: "#F4F4F5",
  },
});

export default CallNoteCard;
