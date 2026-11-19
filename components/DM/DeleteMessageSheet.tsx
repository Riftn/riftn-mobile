/**
 * "Delete message?" for DMs, group DMs and group/community chats, Telegram
 * style. Same glass sheet and rows as the other chat sheets, no red, and a
 * "Remember my choice" tick that saves the pick (hooks/useAppPrefs
 * chatDeleteChoice) so the sheet is skipped next time. Settings → Appearance
 * changes it back. Mirrors web DeleteMessageDialog.
 *
 *   - One-to-one chat: any message can go "for me" or "for me and {name}".
 *   - Groups: your own message "for me" or "for everyone"; anyone else's only
 *     "for me".
 *
 * Dark values only: libs/jsx/tone flips neutral colours on light themes.
 */
import React, { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { SHEET_GLASS_FILL } from "../../theme/sheetGlass";
import { SheetGlassFill } from "../ui/SheetGlass";
import SheetBackdrop, { useSheetBackdrop } from "../ui/SheetBackdrop";
import { useSheetClosed } from "../../hooks/useSheetClosed";
import { getAppPrefs, setAppPref } from "../../hooks/useAppPrefs";

export type DeleteScope = "me" | "everyone";

export interface DeleteRequest {
  /** How many messages (1 for the hold menu). */
  count: number;
  /** The messages can go for everyone too (yours, or any in a one-to-one chat). */
  canDeleteForEveryone: boolean;
  /** One-to-one chat: "for me and {name}" instead of "for everyone". */
  oneToOne?: boolean;
  peerName?: string | null;
  onDelete: (scope: DeleteScope) => void;
  /**
   * "chat": deleting a whole chat (Messages list or chat menu). Always asks
   * (resolveDelete never skips it) and has no "Remember my choice" row.
   */
  subject?: "message" | "chat";
}

/**
 * Ask, unless a choice is saved: then delete straight away ("for everyone"
 * only when allowed, else "for me") and return null. Otherwise return the
 * request for the sheet to show.
 */
export function resolveDelete(req: DeleteRequest): DeleteRequest | null {
  const saved = getAppPrefs().chatDeleteChoice;
  if (saved === "ask" || req.subject === "chat") return req;
  req.onDelete(saved === "everyone" && req.canDeleteForEveryone ? "everyone" : "me");
  return null;
}

const HIDE = 520;

export default function DeleteMessageSheet({ request, onClose }: { request: DeleteRequest | null; onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const backdrop = useSheetBackdrop();
  const visible = !!request;
  const [isFullyClosed, setIsFullyClosed] = useSheetClosed(visible);
  const [remember, setRemember] = useState(false);
  // Keep drawing the last request while the sheet slides away.
  const last = useRef<DeleteRequest | null>(null);
  if (request) last.current = request;
  const req = request ?? last.current;
  const y = useSharedValue(HIDE);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setRemember(false);
      setIsFullyClosed(false);
      y.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
      fade.value = withTiming(1, { duration: 250 });
    } else {
      y.value = withTiming(HIDE, { duration: 220, easing: Easing.in(Easing.cubic) }, () => runOnJS(setIsFullyClosed)(true));
      fade.value = withTiming(0, { duration: 180 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  if ((!visible && isFullyClosed) || !req) return null;

  const many = req.count > 1;
  const wholeChat = req.subject === "chat";
  const title = wholeChat
    ? t("msgDelete.chatTitle", { defaultValue: "Delete this chat?" })
    : many
    ? t("msgDelete.titleMany", { defaultValue: "Delete {{count}} messages?", count: req.count })
    : t("msgDelete.title", { defaultValue: "Delete message?" });
  const body = wholeChat
    ? (req.canDeleteForEveryone
      ? t("msgDelete.chatBodyBoth", { defaultValue: "Delete it from your chats only, or every message for both of you. This can't be undone." })
      : t("msgDelete.chatBodyMe", { defaultValue: "It will be removed from your chats only. Others will still see it." }))
    : req.canDeleteForEveryone
    ? (req.oneToOne
      ? (many
        ? t("msgDelete.bodyOwnBothMany", { defaultValue: "Remove them from your chat only, or for both of you." })
        : t("msgDelete.bodyOwnBoth", { defaultValue: "Remove it from your chat only, or for both of you." }))
      : (many
        ? t("msgDelete.bodyOwnMany", { defaultValue: "Remove them from your chat only, or for everyone." })
        : t("msgDelete.bodyOwn", { defaultValue: "Remove it from your chat only, or for everyone." })))
    : (many
      ? t("msgDelete.bodyOthersMany", { defaultValue: "They will be removed from your chat only. Others in the chat will still see them." })
      : t("msgDelete.bodyOthers", { defaultValue: "It will be removed from your chat only. The other person will still see it." }));
  const everyoneLabel = req.oneToOne
    ? (req.peerName
      ? t("msgDelete.forMeAndName", { defaultValue: "Delete for me and {{name}}", name: req.peerName })
      : t("msgDelete.forBoth", { defaultValue: "Delete for both of us" }))
    : t("msgDelete.forEveryone", { defaultValue: "Delete for everyone" });

  const pick = (scope: DeleteScope) => {
    if (remember && !wholeChat) setAppPref("chatDeleteChoice", scope);
    onClose();
    req.onDelete(scope);
  };

  const Row = ({ icon, label, onPress, testID }: { icon: React.ComponentProps<typeof Icon>["name"]; label: string; onPress: () => void; testID: string }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.row} testID={testID}>
      <Icon name={icon} size={20} color="#F4F4F5" />
      <Text style={styles.rowText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible || !isFullyClosed} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <SheetBackdrop backdrop={backdrop} />
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 10 }, sheetStyle]} testID={wholeChat ? "delete-chat-sheet" : "delete-message-sheet"}>
        <SheetGlassFill backdropBlurred={backdrop.blurred} style={[StyleSheet.absoluteFill, styles.overlay]} />
        <View style={styles.handleWrap}><View style={styles.handle} /></View>
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>
        <View style={styles.group}>
          {req.canDeleteForEveryone ? (
            <>
              <Row icon="Trash2" label={everyoneLabel} onPress={() => pick("everyone")} testID="delete-everyone" />
              <View style={styles.rule} />
            </>
          ) : null}
          <Row icon={req.canDeleteForEveryone ? "EyeOff" : "Trash2"} label={t("msgDelete.forMe", { defaultValue: "Delete for me" })} onPress={() => pick("me")} testID="delete-me" />
        </View>
        {wholeChat ? <View style={{ height: 10 }} /> : <TouchableOpacity
          onPress={() => setRemember((v) => !v)}
          activeOpacity={0.6}
          style={styles.remember}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: remember }}
          testID="delete-remember"
        >
          <View style={[styles.tick, remember && styles.tickOn]}>
            {remember ? <Icon name="Check" size={13} color="#09090B" strokeWidth={3.5} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rememberText}>{t("msgDelete.remember", { defaultValue: "Remember my choice" })}</Text>
            {remember ? (
              <Text style={styles.hint}>{t("msgDelete.rememberHint", { defaultValue: "Change it any time in Settings" })}</Text>
            ) : null}
          </View>
        </TouchableOpacity>}
        <TouchableOpacity onPress={onClose} activeOpacity={0.6} style={styles.cancel} testID="delete-cancel">
          <Text style={styles.cancelText}>{t("common.cancel", { defaultValue: "Cancel" })}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  overlay: { backgroundColor: SHEET_GLASS_FILL, borderTopWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  handleWrap: { alignItems: "center", paddingVertical: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" },
  head: { paddingHorizontal: 20, paddingBottom: 14, gap: 4 },
  title: { color: "#F9FBFF", fontSize: 17, fontWeight: "700" },
  body: { color: "#A6A9AC", fontSize: 13.5, lineHeight: 18 },
  group: {
    marginHorizontal: 12, borderRadius: 14, overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, height: 50 },
  rowText: { color: "#F4F4F5", fontSize: 15.5, fontWeight: "500", flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.12)", marginLeft: 48 },
  remember: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 28, paddingVertical: 14 },
  tick: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.45)", alignItems: "center", justifyContent: "center" },
  tickOn: { backgroundColor: "#F4F4F5", borderColor: "#F4F4F5" },
  rememberText: { color: "#F4F4F5", fontSize: 14.5, fontWeight: "500" },
  hint: { color: "#A6A9AC", fontSize: 12, marginTop: 1 },
  cancel: {
    marginHorizontal: 12, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  cancelText: { color: "#F4F4F5", fontSize: 15.5, fontWeight: "600" },
});
