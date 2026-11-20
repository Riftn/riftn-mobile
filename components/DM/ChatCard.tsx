import React, { memo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAppTheme } from "../../context/ThemeContext";
import { MINIMAL_HAIRLINE } from "../../theme/colors";
import { glassTint } from "../../theme/skins";
import { glowLine } from "../ui/glow";
import { useAppPrefs } from "../../hooks/useAppPrefs";

/*
 * Messages: every chat is its own glass card (design B, as on the web,
 * 2026-11-18). Cards sit 10px apart with no divider lines; something new in a
 * chat lights a bar on the card's left edge, and a ticked card rings in the
 * theme colour. No blur: a long list of blurred cards costs every scroll
 * frame, and the tinted fill reads the same over the page.
 *
 * Written dark; System Light turns the greys around as it renders.
 */

export const CHAT_CARD_GAP = 10;
export const CHAT_CARD_INSET = 12;
const RADIUS = 18;

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
  const { skin, isMinimal, isLight } = useAppTheme();
  const accent = useChatCardAccent();
  const { chatCards } = useAppPrefs();
  if (!chatCards) {
    // Plain list (Settings → Appearance → Chats as cards off): no card, a
    // hairline under each chat, and the same lit bar for something new.
    return (
      <View style={[styles.row, checked && { backgroundColor: "rgba(255,255,255,0.06)" }]} testID={testID}>
        {children}
        <View pointerEvents="none" style={[styles.line, isMinimal && { backgroundColor: MINIMAL_HAIRLINE }]} />
        {unread ? (
          <View pointerEvents="none" testID="chat-card-unread" style={[styles.unread, glowLine(accent, 6)]} />
        ) : null}
      </View>
    );
  }
  const fill = isMinimal
    ? "#000000"
    : skin
      ? glassTint(String(skin.barFill.backgroundColor ?? "rgb(24,24,27)"), 0.62)
      : "rgba(24,24,27,0.78)";
  return (
    <View style={styles.card} testID={testID}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {!isLight && !isMinimal ? (
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "rgba(255,255,255,0)"]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {children}
      <View
        pointerEvents="none"
        style={[
          styles.rim,
          isMinimal && { borderColor: MINIMAL_HAIRLINE },
          checked && { borderColor: accent, borderWidth: 1.5 },
        ]}
      />
      {unread ? (
        <View pointerEvents="none" testID="chat-card-unread" style={[styles.unread, glowLine(accent, 6)]} />
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

/** Gap between chats (none in the plain list) and inset from the screen edge. */
export function useChatListSpacing(): { gap: number; inset: number } {
  const { chatCards } = useAppPrefs();
  return { gap: chatCards ? CHAT_CARD_GAP : 0, inset: CHAT_CARD_INSET };
}

const styles = StyleSheet.create({
  row: {},
  line: {
    position: "absolute",
    left: 72,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  card: {
    borderRadius: RADIUS,
    overflow: "hidden",
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  unread: {
    position: "absolute",
    left: 0,
    top: "50%",
    width: 4,
    height: 28,
    marginTop: -14,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
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
