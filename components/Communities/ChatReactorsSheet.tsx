/**
 * Who reacted to a group chat message. Opened by holding a reaction pill under
 * the message; lists every emoji with the people behind it.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Avatar from "../common/Avatar";
import { InlineEmoji } from "../common/EmojiText";
import { getAvatarUrl } from "../../libs/misc";
import { getAccountSummaries, type AccountSummary } from "../../services/user.service";

export function ChatReactorsSheet({
  reactions,
  focusEmoji,
  onClose,
  onOpenProfile,
}: {
  /** The message's reactions, or null when the sheet is shut. */
  reactions: Record<string, string[]> | null;
  /** The pill that was held; its row is listed first. */
  focusEmoji?: string | null;
  onClose: () => void;
  onOpenProfile?: (identifier: string) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [profiles, setProfiles] = useState<Record<string, AccountSummary>>({});

  const entries = useMemo(() => {
    const list = Object.entries(reactions || {}).filter(([, who]) => who?.length > 0);
    return list.sort(([a], [b]) => (a === focusEmoji ? -1 : b === focusEmoji ? 1 : 0));
  }, [reactions, focusEmoji]);

  useEffect(() => {
    if (!reactions) return;
    const addresses = [...new Set(entries.flatMap(([, who]) => who.map((a) => a.toLowerCase())))]
      .filter((a) => !profiles[a]);
    if (!addresses.length) return;
    let cancelled = false;
    getAccountSummaries(addresses)
      .then((rows) => {
        if (cancelled) return;
        setProfiles((prev) => {
          const next = { ...prev };
          rows.forEach((row) => { if (row?.address) next[row.address.toLowerCase()] = row; });
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // profiles is read only to skip addresses already known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactions, entries]);

  return (
    <Modal visible={!!reactions} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 12) }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t("communities.chatPanel.reactions", { defaultValue: "Reactions" })}</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {entries.map(([emoji, who]) => (
              <View key={emoji} style={styles.group}>
                <View style={styles.groupHead}>
                  <InlineEmoji value={emoji} size={16} />
                  <Text style={styles.count}>{who.length}</Text>
                </View>
                {who.map((address) => {
                  const p = profiles[address.toLowerCase()];
                  const name = p?.displayName || p?.username || `${address.slice(0, 6)}…${address.slice(-4)}`;
                  return (
                    <Pressable
                      key={address}
                      style={styles.person}
                      onPress={() => { onClose(); onOpenProfile?.(p?.username || address); }}
                      accessibilityRole="button"
                    >
                      <Avatar uri={getAvatarUrl(p?.avatarImageUrl || "")} size={32} name={name} />
                      <View style={{ marginLeft: 10, flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>{name}</Text>
                        {!!p?.username && <Text style={styles.handleText} numberOfLines={1}>@{p.username}</Text>}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#18181B", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 12 },
  title: { color: "#FFFFFF", fontSize: 16, fontWeight: "600", marginBottom: 8 },
  group: { marginBottom: 10 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  count: { color: "#A1A1AA", fontSize: 13 },
  person: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  name: { color: "#FFFFFF", fontSize: 14, fontWeight: "500" },
  handleText: { color: "#A1A1AA", fontSize: 12 },
});
