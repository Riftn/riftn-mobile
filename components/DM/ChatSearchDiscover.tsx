import React from "react";
import { ScrollView, Share, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import Avatar from "../common/Avatar";
import Icon, { type IconName } from "../ui/Icon";
import { supabase } from "../../services/supabase";
import { usersSearch } from "../../services/user.service";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { getAvatarUrl } from "../../libs/misc";
import { storageImageSource } from "../../libs/cdnImage";
import { truncateAddress } from "../../libs/strings.util";
import { ScreenNames } from "../../navigation/ScreenNames";
import type { Community } from "../../types/community";
import type { User } from "../../context/AuthContext";

/*
 * What the chat list shows when a search matches none of your chats: the
 * people and communities that do match, a few ways to start something new,
 * and a hand-off to the full search. The list is never left blank.
 */

type Person = User & { dmSettings?: unknown; dmSetting?: unknown; displayName?: string; username?: string; avatarImageUrl?: string; address?: string; walletAddress?: string };

const addrOf = (u: Person) => String(u.walletAddress || u.address || "").toLowerCase();
const nameOf = (u: Person) => u.displayName || u.username || truncateAddress(addrOf(u));

function dmOff(u: Person) {
  const raw = u.dmSettings || u.dmSetting;
  const s = (Array.isArray(raw) ? raw[0] : raw) as { disables?: string[] } | undefined;
  return !!(s?.disables?.includes("NEW_DM") || s?.disables?.includes("all"));
}

const compact = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n || 0);
};

export default function ChatSearchDiscover({ query, myAddress, knownAddresses, onMessageUser, onNewChat, onNewGroup }: {
  query: string;
  myAddress: string;
  /** People you already have a chat with; the search above already covers them. */
  knownAddresses: Set<string>;
  onMessageUser: (u: User) => void;
  onNewChat: () => void;
  onNewGroup: () => void;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const q = useDebouncedValue(query.trim().replace(/^@/, ""), 300);
  const ready = q.length >= 2;

  const { data: people = [], isLoading: peopleLoading } = useQuery({
    queryKey: ["dm", "search-discover", "people", q.toLowerCase()],
    queryFn: async () => {
      const res: any = await usersSearch(q);
      const arr = (res?.data?.result || res?.result || []) as Person[];
      return Array.isArray(arr) ? arr : [];
    },
    enabled: ready,
    staleTime: 60_000,
  });
  const { data: communities = [], isLoading: communitiesLoading } = useQuery({
    queryKey: ["communities", "chat-search", q.toLowerCase()],
    queryFn: async () => {
      // Commas and brackets would break the filter; anything else is literal.
      const term = q.replace(/[%_,()]/g, " ").trim();
      if (!term) return [] as Community[];
      const { data, error } = await supabase
        .from("communities")
        .select("*")
        // Name or @name (the slug in the group's link).
        .or(`name.ilike.%${term}%,slug.ilike.%${term}%`)
        .order("member_count", { ascending: false })
        .limit(4);
      if (error) throw error;
      return (data ?? []) as unknown as Community[];
    },
    enabled: ready,
    staleTime: 60_000,
  });

  const users = people.filter((u) => {
    const a = addrOf(u);
    return a && a !== myAddress && !knownAddresses.has(a);
  }).slice(0, 10);
  const loadingPeople = ready && peopleLoading;
  const loadingCommunities = ready && communitiesLoading;
  const nothingAnywhere = ready && !loadingPeople && !loadingCommunities && !users.length && !communities.length;
  const shown = query.trim();

  const section = (label: string) => <Text style={styles.section}>{label.toUpperCase()}</Text>;

  const actions: { icon: IconName; label: string; sub: string; onPress: () => void }[] = [
    { icon: "Mail", label: t("dm.searchDiscover.newChat"), sub: t("dm.searchDiscover.newChatSub"), onPress: onNewChat },
    { icon: "Users", label: t("dm.searchDiscover.newGroup"), sub: t("dm.searchDiscover.newGroupSub"), onPress: onNewGroup },
    {
      icon: "Share",
      label: t("dm.searchDiscover.invite"),
      sub: t("dm.searchDiscover.inviteSub"),
      onPress: () => { Share.share({ message: t("dm.searchDiscover.inviteMessage", { url: "https://riftn.com" }) }).catch(() => {}); },
    },
  ];

  return (
    <View testID="chat-search-discover" style={styles.wrap}>
      <View style={styles.hintRow}>
        <View style={styles.dot} />
        <Text style={styles.hint}>
          {nothingAnywhere
            ? t("dm.searchDiscover.nothing", { q: shown })
            : t("dm.searchDiscover.noChats", { q: shown })}
        </Text>
      </View>

      {(loadingPeople || users.length > 0) && (
        <>
          {section(t("dm.searchDiscover.people"))}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bubbles} keyboardShouldPersistTaps="handled">
            {loadingPeople && !users.length
              ? Array.from({ length: 5 }).map((_, i) => (
                  <View key={i} style={styles.bubble}>
                    <View style={[styles.skel, { width: 56, height: 56, borderRadius: 28 }]} />
                    <View style={[styles.skel, { width: 44, height: 10, marginTop: 8 }]} />
                  </View>
                ))
              : users.map((u) => {
                  const off = dmOff(u);
                  return (
                    <TouchableOpacity
                      key={addrOf(u)}
                      style={[styles.bubble, off && { opacity: 0.4 }]}
                      disabled={off}
                      onPress={() => onMessageUser(u)}
                      accessibilityRole="button"
                      accessibilityLabel={nameOf(u)}
                      testID={`chat-search-person-${u.username || addrOf(u)}`}
                    >
                      <View style={styles.ring}>
                        <Avatar uri={getAvatarUrl(u.avatarImageUrl)} size={56} name={nameOf(u)} />
                      </View>
                      <Text numberOfLines={1} style={styles.bubbleName}>{nameOf(u).split(/\s+/)[0]}</Text>
                    </TouchableOpacity>
                  );
                })}
          </ScrollView>
        </>
      )}

      {(loadingCommunities || communities.length > 0) && (
        <>
          {section(t("dm.searchDiscover.communities"))}
          <View style={styles.grid}>
            {loadingCommunities
              ? [0, 1].map((i) => <View key={i} style={[styles.card, styles.skel]} />)
              : communities.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.glass, styles.card]}
                    activeOpacity={0.75}
                    onPress={() => navigation.navigate(ScreenNames.CommunityDetail as any, { slug: c.slug, tab: "chat" })}
                    testID={`chat-search-community-${c.slug}`}
                  >
                    {!!c.banner_url && <Image source={storageImageSource(c.banner_url, 200)} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} contentFit="cover" />}
                    <View style={styles.cardScrim} />
                    <View style={styles.cardIcon}>
                      {c.avatar_url
                        ? <Image source={storageImageSource(c.avatar_url, 28)} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                        : <Text style={styles.cardInitial}>{c.name.charAt(0).toUpperCase()}</Text>}
                    </View>
                    <View>
                      <Text numberOfLines={1} style={styles.cardName}>{c.name}</Text>
                      <Text numberOfLines={1} style={styles.sub}>{t("dm.searchDiscover.members", { n: compact(c.member_count) })}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
          </View>
        </>
      )}

      {section(t("dm.searchDiscover.start"))}
      <View style={styles.actions}>
        {actions.map((a) => (
          <TouchableOpacity key={a.icon} style={[styles.glass, styles.action]} activeOpacity={0.75} onPress={a.onPress} accessibilityRole="button">
            <View style={styles.actionIcon}><Icon name={a.icon} size={15} color="#FFFFFF" /></View>
            <Text numberOfLines={1} style={styles.actionLabel}>{a.label}</Text>
            <Text numberOfLines={1} style={styles.sub}>{a.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.glass, styles.searchAll]}
        activeOpacity={0.75}
        onPress={() => navigation.navigate(ScreenNames.Search as any, { q: shown })}
        accessibilityRole="button"
      >
        <View style={[styles.actionIcon, { marginBottom: 0 }]}><Icon name="Search" size={15} color="#FFFFFF" /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.actionLabel}>{t("dm.searchDiscover.searchAll", { q: shown })}</Text>
          <Text numberOfLines={1} style={styles.sub}>{t("dm.searchDiscover.searchAllSub")}</Text>
        </View>
        <Icon name="ChevronRight" size={16} color="#71717A" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 32 },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#71717A" },
  hint: { flex: 1, color: "#A1A1AA", fontSize: 13 },
  section: { color: "#71717A", fontSize: 11, fontWeight: "600", letterSpacing: 1.5, marginTop: 20, marginBottom: 10, paddingHorizontal: 2 },
  bubbles: { gap: 12, paddingHorizontal: 2 },
  bubble: { width: 64, alignItems: "center" },
  ring: { borderRadius: 32, padding: 2, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  bubbleName: { color: "#E4E4E7", fontSize: 12, marginTop: 6, maxWidth: 64 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  glass: { borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(255,255,255,0.04)", overflow: "hidden" },
  card: { width: "48%", flexGrow: 1, height: 104, padding: 12, justifyContent: "space-between", borderRadius: 16 },
  cardScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  cardIcon: { width: 28, height: 28, borderRadius: 8, overflow: "hidden", backgroundColor: "#27272A", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  cardInitial: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  cardName: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  sub: { color: "#71717A", fontSize: 11.5, marginTop: 1 },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1, padding: 12 },
  actionIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.07)" },
  actionLabel: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  searchAll: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginTop: 12 },
  skel: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 8 },
});
