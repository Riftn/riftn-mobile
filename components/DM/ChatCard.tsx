import React, { memo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAppTheme } from "../../context/ThemeContext";
import { MINIMAL_HAIRLINE } from "../../theme/colors";
import { glowLine } from "../ui/glow";
import { useAppPrefs } from "../../hooks/useAppPrefs";

/*
 * Messages: the clean list (picked 2026-11-24, replaces the glass cards).
 * Rows run edge to edge with a hairline between them that starts at the
 * text, round 52px photos, and a small dot in the theme colour on the left
 * edge when something is new.
 *
 * Written dark; System Light turns the greys around as it renders.
 */

export const CHAT_CARD_GAP = 10;
export const CHAT_CARD_INSET = 12;
/** Chat rows: 16px in, a 52px photo, 12px gap, so the text starts at 80. */
export const CHAT_ROW_INSET = 16;
export const CHAT_ROW_PHOTO = 52;
export const CHAT_ROW_TEXT_LEFT = CHAT_ROW_INSET + CHAT_ROW_PHOTO + 12;
export const CHAT_ROW_MIN_HEIGHT = 76;

/** The theme colour a lit bar, a ring or a selected tab takes. */
export function useChatCardAccent(): string {
  const { accent, skin, isLight, isMinimal } = useAppTheme();
  if (isLight || isMinimal || !skin) return "#FFFFFF";
  const [r, g, b] = accent;
  // Same as web: the theme colour mixed 62% with white.
  const mix = (c: number) => Math.round(c * 0.62 + 255 * 0.38);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function ChatCardComponent({
  children,
  unread = false,
  checked = false,
  testID,
}: {
  children: React.ReactNode;
  unread?: boolean;
  checked?: boolean;
  testID?: string;
}) {
  const { isMinimal } = useAppTheme();
  const accent = useChatCardAccent();
  const { messagesPills } = useAppPrefs();
  // Pill look: the round count says it, no dot on the edge.
  if (messagesPills) unread = false;
  // The clean list (2026-11-24, phones): no card, a hairline that starts
  // where the text does, and a small dot on the left edge for something new.
  return (
    <View style={[styles.row, checked && { backgroundColor: "rgba(255,255,255,0.06)" }]} testID={testID}>
      {children}
      <View pointerEvents="none" style={[styles.line, isMinimal && { backgroundColor: MINIMAL_HAIRLINE }]} />
      {unread ? (
        <View pointerEvents="none" testID="chat-card-unread" style={[styles.dot, { backgroundColor: accent }]} />
      ) : null}
    </View>
  );
}

export const ChatCard = memo(ChatCardComponent);

export type ChatListTab = "all" | "unread" | "groups" | "requests";

/** All / Unread / Groups / Requests: a row at the top of the list. */
export function ChatListTabs({
  tabs,
  active,
  onPick,
}: {
  tabs: { key: ChatListTab; label: string; count?: number }[];
  active: ChatListTab;
  onPick: (tab: ChatListTab) => void;
}) {
  const accent = useChatCardAccent();
  // Written dark: on System Light the white chip turns ink and this ink turns white.
  const accentInk = accent === "#FFFFFF" ? "#0B0B0C" : "#FFFFFF";
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabs}
      style={styles.tabsScroll}
      keyboardShouldPersistTaps="handled"
    >
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onPick(tab.key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            testID={`chat-tab-${tab.key}`}
            style={[styles.tab, on && styles.tabOn]}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{tab.label}</Text>
            {tab.count ? (
              <View style={[styles.count, { backgroundColor: accent }]}>
                <Text style={[styles.countText, { color: accentInk }]}>{tab.count > 99 ? "99+" : tab.count}</Text>
              </View>
            ) : null}
            {on ? <View style={[styles.beam, glowLine(accent)]} /> : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/** The clean list runs edge to edge with no gap; each row carries its own 16px inset. */
export function useChatListSpacing(): { gap: number; inset: number } {
  return { gap: 0, inset: 0 };
}

const styles = StyleSheet.create({
  row: {},
  line: {
    position: "absolute",
    left: CHAT_ROW_TEXT_LEFT,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  dot: {
    position: "absolute",
    left: 5,
    top: "50%",
    width: 7,
    height: 7,
    marginTop: -3.5,
    borderRadius: 4,
  },
  tabsScroll: { flexGrow: 0, marginHorizontal: -CHAT_CARD_INSET },
  tabs: { paddingHorizontal: CHAT_CARD_INSET, paddingTop: 2, paddingBottom: 4, gap: 4 },
  tab: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tabOn: { backgroundColor: "rgba(255,255,255,0.09)" },
  tabText: { fontSize: 13, fontWeight: "600", color: "#A1A1AA" },
  tabTextOn: { color: "#FFFFFF" },
  count: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  beam: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: -1,
    height: 2,
    borderRadius: 2,
  },
});
