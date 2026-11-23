/**
 * The weekly drop: picked minted posts, this week's market numbers, live
 * auctions, and a way to put your own post forward. Port of web's DropsTab.
 */
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import { formatCount } from "../../libs/format-count";
import { toastError, toastSuccess } from "../../libs/toast";
import { ScreenNames } from "../../navigation/ScreenNames";
import { getMyPosts } from "../../services/user.service";
import { formatPrice } from "../NftMarket/NftTile";
import { collect, timeLeft, type Auction, type DropItem, type MarketStats } from "../../services/collect.service";

const money = (amount: number) => amount.toLocaleString(undefined, { maximumFractionDigits: amount >= 100 ? 0 : 2 });

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Stats({ stats }: { stats: MarketStats }) {
  const { t } = useTranslation();
  const cells = [
    [t("collect.statSales", { defaultValue: "Sales this week" }), formatCount(stats.sales)],
    [t("collect.statVolume"), stats.volume.length ? stats.volume.slice(0, 2).map((v) => `${money(v.amount)} ${v.symbol}`).join("\n") : "0"],
    [t("collect.statAuctions", { defaultValue: "Live auctions" }), formatCount(stats.liveAuctions)],
    [t("collect.statCollectors", { defaultValue: "Collectors" }), formatCount(stats.collectors)],
  ];
  return (
    <View style={styles.statsGrid}>
      {cells.map(([label, value]) => (
        <View key={label} style={styles.stat}>
          <Text style={styles.faint} numberOfLines={1}>{label}</Text>
          <Text style={styles.statValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function DropCard({ item, onPress }: { item: DropItem; onPress: () => void }) {
  const { t } = useTranslation();
  const creator = item.creatorProfile?.username ? `@${item.creatorProfile.username}` : item.creatorProfile?.displayName ?? null;
  return (
    <Pressable onPress={onPress} style={styles.card} accessibilityRole="button">
      <View style={styles.art}>
        {item.image ? <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        {item.auctionId ? <Text style={styles.badge}>{t("collect.auctionChip", { defaultValue: "Auction" })}</Text> : null}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        {creator ? <Text style={styles.faint} numberOfLines={1}>{creator}</Text> : null}
        <Text style={styles.muted} numberOfLines={1}>
          {item.floor
            ? t("collect.floor", { price: `${formatPrice(item.floor.price, item.floor.currencyDecimals)} ${item.floor.currencySymbol}`, defaultValue: "From {{price}}" })
            : item.supply === 1
              ? t("collect.oneOfOne", { defaultValue: "1 of 1" })
              : t("collect.copiesPill", { copies: formatCount(item.supply), defaultValue: "{{copies}} copies" })}
        </Text>
      </View>
    </Pressable>
  );
}

function AuctionCard({ auction, now, onPress }: { auction: Auction; now: number; onPress: () => void }) {
  const { t } = useTranslation();
  const left = Date.parse(auction.endsAt) - now;
  return (
    <Pressable onPress={onPress} style={[styles.card, { width: 150 }]} accessibilityRole="button">
      <View style={styles.art}>
        {auction.nftImage ? <Image source={{ uri: auction.nftImage }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.name} numberOfLines={1}>{auction.nftName || `#${auction.tokenId}`}</Text>
        <Text style={styles.muted} numberOfLines={1}>{formatPrice(auction.topBid ?? auction.startPrice, auction.currencyDecimals)} {auction.currencySymbol}</Text>
        <Text style={styles.faint}>
          {left > 0 ? t("collect.endsInShort", { time: timeLeft(left), defaultValue: "{{time}} left" }) : t("collect.auctionEnded", { defaultValue: "Ended" })}
        </Text>
      </View>
    </Pressable>
  );
}

function PutForward() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  const mine = useQuery({ queryKey: ["drop-applications", "mine"], queryFn: collect.myApplications, staleTime: 60_000 });
  const posts = useQuery({ queryKey: ["drop-applications", "posts"], queryFn: () => getMyPosts({ unit: 30 }), enabled: open, staleTime: 60_000 });
  const status = new Map((mine.data?.items ?? []).map((a) => [a.tokenId, a.status]));
  const minted = ((posts.data?.result ?? []) as any[]).filter((p) => p.status === "minted");

  const apply = async (tokenId: number) => {
    setSending(tokenId);
    try {
      await collect.applyToDrop(tokenId);
      toastSuccess(t("collect.applied", { defaultValue: "Put forward. We will tell you if it is picked." }));
      void qc.invalidateQueries({ queryKey: ["drop-applications"] });
    } catch (e) {
      toastError((e as Error)?.message || t("collect.saveFailed", { defaultValue: "Could not save" }));
    } finally {
      setSending(null);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t("collect.putForwardTitle", { defaultValue: "Get your post in the next drop" })}</Text>
      <Text style={styles.muted}>{t("collect.putForwardBody", { defaultValue: "Pick one of your minted posts. Each Monday we choose what goes in the drop." })}</Text>
      {!open ? (
        <Pressable onPress={() => setOpen(true)} style={styles.btnQuiet} accessibilityRole="button">
          <Text style={styles.btnQuietText}>{t("collect.putForward", { defaultValue: "Put a post forward" })}</Text>
        </Pressable>
      ) : posts.isLoading ? (
        <ActivityIndicator color="#fff" />
      ) : minted.length ? (
        minted.slice(0, 12).map((p) => {
          const id = Number(p.tokenId);
          const s = status.get(id);
          return (
            <View key={id} style={styles.applyRow}>
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{p.name || p.title || `#${id}`}</Text>
              {s ? (
                <Text style={s === "accepted" ? styles.ok : styles.faint}>
                  {s === "accepted"
                    ? t("collect.statusPicked", { defaultValue: "Picked" })
                    : s === "declined"
                      ? t("collect.statusNotPicked", { defaultValue: "Not this time" })
                      : t("collect.statusWaiting", { defaultValue: "Waiting" })}
                </Text>
              ) : (
                <Pressable onPress={() => apply(id)} disabled={sending != null} style={styles.btnQuietSmall} accessibilityRole="button">
                  {sending === id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnQuietText}>{t("collect.apply", { defaultValue: "Put forward" })}</Text>}
                </Pressable>
              )}
            </View>
          );
        })
      ) : (
        <Text style={styles.muted}>{t("collect.noMinted", { defaultValue: "Mint a post first, then you can put it forward." })}</Text>
      )}
    </View>
  );
}

export default function DropsTab({ signedIn, onOpenPost }: { signedIn: boolean; onOpenPost: (tokenId: string) => void }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const now = useNow();
  const drop = useQuery({ queryKey: ["drops", "current"], queryFn: collect.currentDrop, staleTime: 60_000 });
  const stats = useQuery({ queryKey: ["market-stats"], queryFn: collect.stats, staleTime: 120_000 });
  const auctions = useQuery({ queryKey: ["nft-market", "auctions", "live"], queryFn: () => collect.auctions({ limit: 20 }), staleTime: 30_000 });
  const d = drop.data;
  const live = auctions.data?.items ?? [];
  const next = d ? Date.parse(d.nextDropAt ?? d.endsAt) - now : 0;

  return (
    <ScrollView contentContainerStyle={styles.body} testID="drops-tab">
      {stats.data ? <Stats stats={stats.data} /> : null}

      <View style={styles.section}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            {d ? <Text style={styles.eyebrow}>{t("collect.dropNumber", { n: d.number, defaultValue: "Drop {{n}}" })}</Text> : null}
            <Text style={styles.sectionTitle}>{d?.title || t("collect.thisWeek", { defaultValue: "This week's drop" })}</Text>
          </View>
          {d && next > 0 ? <Text style={styles.faint}>{t("collect.nextDropIn", { time: timeLeft(next), defaultValue: "Next drop in {{time}}" })}</Text> : null}
        </View>
        {drop.isLoading ? (
          <ActivityIndicator color="#fff" style={{ marginVertical: 24 }} />
        ) : d?.items.length ? (
          <View style={styles.grid}>
            {d.items.map((item) => (
              <View key={item.tokenId} style={styles.gridCell}>
                <DropCard item={item} onPress={() => onOpenPost(String(item.tokenId))} />
              </View>
            ))}
          </View>
        ) : (
          <View style={{ alignItems: "center", paddingVertical: 24, gap: 6 }}>
            <Text style={styles.name}>{t("collect.emptyDrop", { defaultValue: "Nothing in this drop yet" })}</Text>
            <Text style={[styles.muted, { textAlign: "center" }]}>{t("collect.emptyDropBody", { defaultValue: "Minted posts with the most love this week land here." })}</Text>
          </View>
        )}
      </View>

      {live.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("collect.statAuctions", { defaultValue: "Live auctions" })}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {live.map((a) => (
              <AuctionCard
                key={a.id}
                auction={a}
                now={now}
                onPress={() => navigation.navigate(ScreenNames.NftMarket, { chain: a.chainId, contract: a.contract, token: a.tokenId })}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {stats.data?.topSellers.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("collect.topSellers", { defaultValue: "Top sellers this week" })}</Text>
          {stats.data.topSellers.slice(0, 5).map((s, i) => (
            <View key={s.address} style={styles.applyRow}>
              <Text style={[styles.faint, { width: 16 }]}>{i + 1}</Text>
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{s.profile?.username ? `@${s.profile.username}` : `${s.address.slice(0, 6)}…${s.address.slice(-4)}`}</Text>
              <Text style={styles.muted}>{t("collect.nSales", { n: formatCount(s.sales), defaultValue: "{{n}} sales" })}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {signedIn ? <PutForward /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 8, gap: 12, paddingBottom: 120 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexBasis: "48%", flexGrow: 1, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 12, paddingVertical: 10 },
  statValue: { color: "#FFFFFF", fontSize: 17, fontWeight: "700", marginTop: 2 },
  section: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  eyebrow: { color: "#808089", fontSize: 10.5, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" },
  sectionTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  gridCell: { width: "50%", padding: 4 },
  card: { borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.05)" },
  art: { width: "100%", aspectRatio: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  badge: { position: "absolute", top: 8, left: 8, color: "#FFFFFF", fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.7)", overflow: "hidden" },
  cardBody: { padding: 8, gap: 2 },
  name: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  muted: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
  faint: { color: "rgba(255,255,255,0.45)", fontSize: 12 },
  ok: { color: "#6EE7B7", fontSize: 12 },
  applyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.1)" },
  btnQuiet: { alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  btnQuietSmall: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.1)" },
  btnQuietText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
});
