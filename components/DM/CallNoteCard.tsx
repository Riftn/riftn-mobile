import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useCall } from "../../context/CallContext";
import { useAppTheme } from "../../context/ThemeContext";
import { callTypeLabel, describeCallNote, endedCallLabel } from "../../libs/callNote";

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
  const { pageColors: colors, isMinimal } = useAppTheme();
  const note = describeCallNote(content);
  const kind = callTypeLabel(note, t);
  const icon = note.video ? "Video" : "Phone";

  if (note.kind === "started") {
    return (
      <View style={styles.quiet}>
        <Icon name={icon} size={12} color={colors.mutedForeground} />
        <Text style={[styles.quietText, { color: colors.mutedForeground }]}>{kind} · {time}</Text>
      </View>
    );
  }

  const title = note.kind === "ended"
    ? endedCallLabel(t)
    : note.kind === "declined"
      ? t("calls.declined")
      : isMine ? t("calls.noAnswer") : t("calls.missed");
  const sub = note.kind === "ended" ? [kind, note.duration, time].filter(Boolean).join(" · ") : `${kind} · ${time}`;
  // A call someone else missed or one that simply ended does not need shouting about.
  const quietButton = note.kind === "ended" || isMine;
  const busy = !!currentCall;
  const buttonBackground = quietButton ? colors.muted : colors.accent;
  const buttonForeground = quietButton ? colors.cardForeground : colors.accentForeground;

  return (
    <View style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, isMinimal && styles.square]}>
        <View style={[styles.icon, { backgroundColor: colors.muted }, isMinimal && styles.square]}>
          <Icon name={note.kind === "ended" ? icon : "PhoneOff"} size={16} color={colors.cardForeground} />
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.cardForeground }]}>{title}</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>{sub}</Text>
        </View>
        {peerAddress ? (
          <Pressable
            onPress={() => { void startCall(peerAddress, note.video ? "video" : "audio"); }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("calls.callBack")}
            accessibilityState={{ disabled: busy }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.go,
              { backgroundColor: buttonBackground },
              isMinimal && styles.square,
              busy ? styles.goDisabled : pressed && styles.goPressed,
            ]}
          >
            <Text style={[styles.goText, { color: buttonForeground }]}>{t("calls.callBack")}</Text>
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
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "700",
  },
  sub: {
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
  },
  go: {
    minHeight: 36,
    maxWidth: "45%",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  goDisabled: {
    opacity: 0.5,
  },
  goPressed: {
    opacity: 0.85,
  },
  goText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  square: {
    borderRadius: 0,
  },
});

export default CallNoteCard;
