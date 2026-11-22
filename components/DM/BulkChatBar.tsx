/**
 * The bar at the foot of the Messages list while chats are selected (hold a
 * chat, Select, then tap others). Acts on every selected chat at once: mark
 * read (or unread), send one reply to all of them, or delete. Same actions and
 * copy as the website's BulkChatBar.
 */
import React, { memo, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import Icon from "../ui/Icon";
import ThemeSurface from "../ui/ThemeSurface";
import { FIELD_TEXT } from "../../theme/inputs";

interface Props {
  count: number;
  /** DMs can be deleted; group and community chats cannot, so they don't count. */
  deletableCount: number;
  /** Every selected chat is already unread, so the button reads "Mark read". */
  allUnread: boolean;
  onToggleUnread: () => void;
  onToggleArchive?: () => void;
  allArchived?: boolean;
  onDelete: () => void;
  /** Resolves with how many chats the reply reached. */
  onReply: (text: string) => Promise<number>;
  onCancel: () => void;
}

// Written for the dark look; the light theme's tone layer flips neutrals itself.
const INK = "#F4F4F5";
const MUTED = "#A1A1AA";
const DANGER = "#F87171";

function BarButton({ icon, label, onPress, disabled, color = INK, testID }: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={({ pressed }) => ({ flex: 1, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      <View style={{ minHeight: 52, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 12 }}>
        <Icon name={icon as any} size={20} color={color} />
        <Text style={{ fontSize: 12, fontWeight: "600", color }} numberOfLines={1}>{label}</Text>
      </View>
    </Pressable>
  );
}

function BulkChatBarComponent({ count, deletableCount, allUnread, onToggleUnread, onToggleArchive, allArchived, onDelete, onReply, onCancel }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [replyOpen, setReplyOpen] = useState(false);
  const none = count === 0;

  return (
    <>
      <Animated.View
        entering={FadeInDown.duration(180)}
        exiting={FadeOutDown.duration(140)}
        testID="chat-bulk-bar"
        accessibilityRole="toolbar"
        accessibilityLabel={t("chatBulk.toolbar", { defaultValue: "Selected chats" })}
        style={{ position: "absolute", left: 10, right: 10, bottom: Math.max(insets.bottom, 10) + 4 }}
      >
        <View style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", paddingHorizontal: 6, paddingTop: 6, paddingBottom: 4 }}>
          <ThemeSurface radius={18} />
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 2 }}>
            <Text testID="chat-bulk-count" style={{ flex: 1, fontSize: 14, fontWeight: "600", color: INK }} numberOfLines={1}>
              {none
                ? t("chatBulk.pick", { defaultValue: "Tap chats to select them" })
                : t("chatBulk.selected", { defaultValue: "{{count}} selected", count })}
            </Text>
            <Pressable
              onPress={onCancel}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t("chatBulk.cancel", { defaultValue: "Cancel" })}
              testID="chat-bulk-cancel"
              style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}
            >
              <Icon name="X" size={18} color={MUTED} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 4 }}>
            <BarButton
              icon={allUnread ? "MailOpen" : "Mail"}
              label={allUnread ? t("chatBulk.read", { defaultValue: "Mark read" }) : t("chatBulk.unread", { defaultValue: "Mark unread" })}
              onPress={onToggleUnread}
              disabled={none}
              testID="chat-bulk-unread"
            />
            {onToggleArchive && (
              <BarButton icon="Archive"
                label={allArchived ? t("editor.cloud.restore", { defaultValue: "Restore" }) : t("stores.archive", { defaultValue: "Archive" })}
                onPress={onToggleArchive} disabled={none} testID="chat-bulk-archive"
              />
            )}
            <BarButton
              icon="Reply"
              label={t("chatBulk.reply", { defaultValue: "Reply" })}
              onPress={() => setReplyOpen(true)}
              disabled={none}
              testID="chat-bulk-reply"
            />
            <BarButton
              icon="Trash2"
              label={t("chatBulk.delete", { defaultValue: "Delete" })}
              onPress={onDelete}
              disabled={none || deletableCount === 0}
              color={DANGER}
              testID="chat-bulk-delete"
            />
          </View>
        </View>
      </Animated.View>
      <BulkReplySheet open={replyOpen} onClose={() => setReplyOpen(false)} count={count} onSend={onReply} />
    </>
  );
}

function BulkReplySheet({ open, onClose, count, onSend }: {
  open: boolean;
  onClose: () => void;
  count: number;
  onSend: (text: string) => Promise<number>;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const boxRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => boxRef.current?.focus(), 120);
    return () => clearTimeout(id);
  }, [open]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const sent = await onSend(body);
      if (sent > 0) {
        setText("");
        onClose();
      }
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;
  const canSend = !!text.trim() && !sending;

  return (
    <Modal transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { if (!sending) onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", paddingHorizontal: 20 }} onPress={() => { if (!sending) onClose(); }}>
          <Pressable testID="chat-bulk-reply-sheet" style={{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", padding: 16 }}>
            <ThemeSurface radius={16} />
            <Text style={{ fontSize: 17, fontWeight: "700", color: INK }}>
              {t("chatBulk.replyTitle", { defaultValue: "Reply to {{count}} chats", count })}
            </Text>
            <Text style={{ fontSize: 13, lineHeight: 18, color: MUTED, marginTop: 4 }}>
              {t("chatBulk.replyHint", { defaultValue: "Each person gets this as a normal message in their own chat." })}
            </Text>
            <TextInput
              ref={boxRef}
              testID="chat-bulk-reply-input"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={4000}
              placeholder={t("chatBulk.replyPlaceholder", { defaultValue: "Write a message…" })}
              placeholderTextColor="#71717A"
              style={[FIELD_TEXT, {
                position: "relative", zIndex: 1, marginTop: 12, minHeight: 96, maxHeight: 180, padding: 12, borderRadius: 12,
                borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.05)",
                color: INK, fontSize: 15, textAlignVertical: "top",
              }]}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <Pressable
                onPress={onClose}
                disabled={sending}
                accessibilityRole="button"
                style={({ pressed }) => ({ height: 40, paddingHorizontal: 16, borderRadius: 12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: "#D4D4D8" }}>{t("chatBulk.cancel", { defaultValue: "Cancel" })}</Text>
              </Pressable>
              <Pressable
                onPress={() => void send()}
                disabled={!canSend}
                accessibilityRole="button"
                testID="chat-bulk-reply-send"
                style={({ pressed }) => ({ opacity: !canSend ? 0.4 : pressed ? 0.8 : 1 })}
              >
                {/* The fill sits on an inner View so themed Pressable repaints leave it alone. */}
                <View style={{ height: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {sending && <ActivityIndicator size="small" color={INK} />}
                  <Text style={{ fontSize: 14, fontWeight: "700", color: INK }}>
                    {t("chatBulk.sendAll", { defaultValue: "Send to {{count}}", count })}
                  </Text>
                </View>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A picked row's wash; sits on an inner View so themed Pressable repaints leave it alone. */
export const CHECKED_FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.07)" } as const;

/** A round tick at the start of a chat row while picking several chats. */
export function BulkTick({ checked }: { checked: boolean }) {
  return (
    <View
      testID="chat-bulk-tick"
      style={{
        width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center",
        borderWidth: 1.5, borderColor: checked ? "#FFFFFF" : "rgba(255,255,255,0.32)",
        backgroundColor: checked ? "#FFFFFF" : "transparent",
      }}
    >
      {checked && <Icon name="Check" size={14} color="#0B0B0C" strokeWidth={3} />}
    </View>
  );
}

/** A chat you marked unread yourself (nothing new from the server). */
export function MarkedUnreadDot() {
  return <View testID="chat-marked-unread" style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: "#FFFFFF" }} />;
}

export default memo(BulkChatBarComponent);
