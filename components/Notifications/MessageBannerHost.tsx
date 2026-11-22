/**
 * New message banner, inside the app.
 *
 * While the app is open a message no longer drops the phone's own banner over
 * it: this glass card slides in from the top instead. Tap it to open the chat,
 * flick it up to put it away, or pull it down (or press Reply) to answer in a
 * box right there without leaving the screen you are on. Group messages open
 * the chat; quick reply is for one-to-one chats.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { SheetGlassFill } from "../ui/SheetGlass";
import { SHEET_GLASS_FILL } from "../../theme/sheetGlass";
import { MOTION, SNAP_SPRING } from "../../theme/motion";
import { useAppTheme } from "../../context/ThemeContext";
import { useAuthState } from "../../context/AuthContext";
import { ScreenNames } from "../../navigation/ScreenNames";
import { setMessageBannerListener, type MessageBanner } from "../../libs/message-banner";
import { isConversationOpen } from "../../libs/activeChat";
import { getAvatarUrl } from "../../libs/misc";
import { toastError } from "../../libs/toast";

/** How long an untouched banner stays. */
const SHOW_MS = 5000;
/** How far a pull has to travel before it opens the reply box. */
const PULL_OPEN = 36;
const CARD_HIDDEN = -220;

type Peer = { avatar?: string | null; name?: string };

export default function MessageBannerHost() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { pageColors, isLight } = useAppTheme();
  const { isSignedIn, needsUsername } = useAuthState();

  // Same inks as the other floating cards: System Light gets hsla() so its
  // colour pass leaves them alone on the pale glass.
  const ink = isLight ? "hsla(240,6%,10%,1)" : pageColors.foreground;
  const muted = isLight ? "hsla(240,4%,30%,1)" : "rgba(255,255,255,0.72)";
  const wash = isLight ? "hsla(0,0%,0%,0.05)" : "rgba(255,255,255,0.06)";
  const hairline = isLight ? "hsla(0,0%,0%,0.10)" : "rgba(255,255,255,0.12)";
  const handle = isLight ? "hsla(0,0%,0%,0.22)" : "rgba(255,255,255,0.32)";

  const [banner, setBanner] = useState<MessageBanner | null>(null);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent">("idle");
  const [peer, setPeer] = useState<Peer | null>(null);

  const y = useRef(new Animated.Value(CARD_HIDDEN)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownIds = useRef<string[]>([]);
  const bannerRef = useRef<MessageBanner | null>(null);
  bannerRef.current = banner;
  const replyingRef = useRef(false);
  replyingRef.current = replying;
  const textRef = useRef("");
  textRef.current = text;

  const clearTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const hide = useCallback(() => {
    clearTimer();
    Keyboard.dismiss();
    Animated.timing(y, { toValue: CARD_HIDDEN, duration: MOTION.close, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => {
        if (!finished) return;
        setBanner(null);
        setReplying(false);
        setText("");
        setSendState("idle");
        setPeer(null);
      });
  }, [y]);

  const armTimer = useCallback((ms = SHOW_MS) => {
    clearTimer();
    hideTimer.current = setTimeout(() => {
      if (!replyingRef.current) hide();
    }, ms);
  }, [hide]);

  // Take messages from the push handler while signed in.
  useEffect(() => {
    if (!isSignedIn || needsUsername) return;
    return setMessageBannerListener((next) => {
      if (shownIds.current.includes(next.id)) return;
      shownIds.current = [...shownIds.current.slice(-19), next.id];
      if (isConversationOpen(next.conversationId)) return;
      const current = bannerRef.current;
      // Mid-reply: a newer line in the same chat updates the card, another
      // chat waits in the notification list rather than taking the box away.
      if (current && replyingRef.current) {
        if (current.conversationId === next.conversationId) setBanner(next);
        return;
      }
      if (!current || current.conversationId !== next.conversationId) setPeer(null);
      setBanner(next);
      setReplying(false);
      setText("");
      setSendState("idle");
      Animated.timing(y, { toValue: 0, duration: MOTION.open, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      armTimer();
    });
  }, [isSignedIn, needsUsername, y, armTimer]);

  // Signing out takes the card away.
  useEffect(() => {
    if (!isSignedIn && bannerRef.current) hide();
  }, [isSignedIn, hide]);

  useEffect(() => () => clearTimer(), []);

  // The other person's picture, once per chat.
  const conversationId = banner?.conversationId;
  const group = !!banner?.group;
  useEffect(() => {
    if (!conversationId || group) return;
    let live = true;
    void (async () => {
      try {
        const { getConversation } = require("../../services/dm/dm.api") as typeof import("../../services/dm/dm.api");
        const { getAuthUser } = require("../../libs/auth.utils") as typeof import("../../libs/auth.utils");
        const [conversation, me] = await Promise.all([getConversation(conversationId), getAuthUser<{ address?: string; walletAddress?: string }>()]);
        const mine = String(me?.address || me?.walletAddress || "").toLowerCase();
        const other: any = conversation.participants
          .map((p: any) => p?.participant)
          .find((p: any) => p?.address && String(p.address).toLowerCase() !== mine);
        if (live && other) setPeer({ avatar: other.avatarImageUrl, name: other.displayName || other.username });
      } catch { /* the card reads fine without a picture */ }
    })();
    return () => { live = false; };
  }, [conversationId, group]);

  const openChat = useCallback(() => {
    const current = bannerRef.current;
    if (!current) return;
    hide();
    navigation.navigate(ScreenNames.Chat, { conversationId: current.conversationId });
  }, [hide, navigation]);

  const startReply = useCallback(() => {
    if (!bannerRef.current || bannerRef.current.group) return;
    clearTimer();
    setReplying(true);
    void Haptics.selectionAsync().catch(() => undefined);
  }, []);

  const send = useCallback(async () => {
    const current = bannerRef.current;
    const words = textRef.current.trim();
    if (!current || !words || sendState === "sending") return;
    setSendState("sending");
    try {
      const { sendQuickReply } = require("../../libs/quick-reply") as typeof import("../../libs/quick-reply");
      await sendQuickReply({ conversationId: current.conversationId, text: words, recipient: current.recipient });
      setSendState("sent");
      setText("");
      Keyboard.dismiss();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setReplying(false);
      armTimer(1200);
    } catch (error: any) {
      setSendState("idle");
      const { needsChat } = require("../../libs/quick-reply") as typeof import("../../libs/quick-reply");
      if (needsChat(error)) {
        openChat();
        return;
      }
      toastError(error?.message || t("quickReply.failedTitle", { defaultValue: "Your reply wasn't sent" }));
    }
  }, [armTimer, openChat, sendState, t]);

  // Flick up to put away, pull down to reply. Taps fall through to the card.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => clearTimer(),
    onPanResponderMove: (_e, g) => {
      // Down only gives a little (it opens the box rather than moving the card).
      y.setValue(g.dy < 0 ? g.dy : Math.min(g.dy * 0.35, 24));
    },
    onPanResponderRelease: (_e, g) => {
      if (g.dy < -30 || g.vy < -0.6) {
        hide();
        return;
      }
      Animated.spring(y, { toValue: 0, ...SNAP_SPRING, useNativeDriver: true }).start();
      if (g.dy > PULL_OPEN && !replyingRef.current) startReply();
      else if (!replyingRef.current) armTimer();
    },
    onPanResponderTerminate: () => {
      Animated.spring(y, { toValue: 0, ...SNAP_SPRING, useNativeDriver: true }).start();
      if (!replyingRef.current) armTimer();
    },
  }), [y, hide, startReply, armTimer]);

  if (!banner) return null;

  const title = peer?.name && !banner.group ? peer.name : banner.title;
  const body = sendState === "sent"
    ? t("quickReply.sent", { defaultValue: "Reply sent" })
    : banner.body;

  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + 6 }]}>
      <Animated.View
        {...pan.panHandlers}
        style={[styles.card, { borderColor: hairline, transform: [{ translateY: y }] }]}
        accessibilityLiveRegion="polite"
      >
        <SheetGlassFill allThemes style={[StyleSheet.absoluteFill, { backgroundColor: SHEET_GLASS_FILL }]} />
        <Pressable
          onPress={openChat}
          accessibilityRole="button"
          accessibilityLabel={t("quickReply.open", { defaultValue: "Open chat" })}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
        >
          {banner.group || !peer ? (
            <View style={[styles.iconBox, { backgroundColor: wash }]}>
              <Icon name="MessageCircle" size={18} color={ink} />
            </View>
          ) : (
            <Avatar uri={getAvatarUrl(peer.avatar, 40)} size={40} name={peer.name} />
          )}
          <View style={styles.words}>
            <Text style={[styles.title, { color: ink }]} numberOfLines={1}>{title}</Text>
            {sendState === "sent" ? (
              <View style={styles.sentLine}>
                <Icon name="Check" size={14} color={ink} />
                <Text style={[styles.body, { color: muted }]} numberOfLines={1}>{body}</Text>
              </View>
            ) : body ? (
              <Text style={[styles.body, { color: muted }]} numberOfLines={replying ? 3 : 2}>{body}</Text>
            ) : null}
          </View>
          {!banner.group && !replying && sendState !== "sent" ? (
            <Pressable
              onPress={startReply}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("quickReply.reply", { defaultValue: "Reply" })}
              style={({ pressed }) => [styles.replyChip, { backgroundColor: wash, borderColor: hairline }, pressed && { opacity: 0.85 }]}
            >
              <Icon name="Reply" size={14} color={ink} />
              <Text style={[styles.replyLabel, { color: ink }]}>{t("quickReply.reply", { defaultValue: "Reply" })}</Text>
            </Pressable>
          ) : null}
        </Pressable>

        {replying ? (
          <View style={styles.replyRow}>
            <TextInput
              autoFocus
              value={text}
              onChangeText={setText}
              placeholder={t("quickReply.placeholder", { defaultValue: "Write a reply…" })}
              placeholderTextColor={muted}
              style={[styles.input, { color: ink, backgroundColor: wash, borderColor: hairline }]}
              multiline
              maxLength={5000}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={() => void send()}
              editable={sendState !== "sending"}
            />
            <Pressable
              onPress={() => void send()}
              disabled={!text.trim() || sendState === "sending"}
              accessibilityRole="button"
              accessibilityLabel={t("quickReply.send", { defaultValue: "Send" })}
              style={({ pressed }) => [
                styles.sendBox,
                { backgroundColor: wash, borderColor: hairline, opacity: !text.trim() ? 0.45 : pressed ? 0.85 : 1 },
              ]}
            >
              {sendState === "sending"
                ? <ActivityIndicator size="small" color={ink} />
                : <Icon name="Send" size={18} color={ink} />}
            </Pressable>
          </View>
        ) : !banner.group && sendState !== "sent" ? (
          <View style={styles.grabArea} pointerEvents="none">
            <View style={[styles.grabber, { backgroundColor: handle }]} />
          </View>
        ) : (
          <View style={{ height: 10 }} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: 8,
    right: 8,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  words: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14, lineHeight: 18, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 18 },
  sentLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  replyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  replyLabel: { fontSize: 13, fontWeight: "600" },
  replyRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 112,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "ios" ? 11 : 8,
    paddingBottom: Platform.OS === "ios" ? 11 : 8,
    fontSize: 15,
  },
  sendBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  grabArea: { alignItems: "center", paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 36, height: 4, borderRadius: 2 },
});
