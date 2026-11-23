/**
 * Trending on Explore, by reactions or by what posts earned.
 *
 * Three words under the Trending title: Reactions (most viewed and liked this
 * week, the list as it always was), PPV (what unlocks paid) and Tips (what was
 * tipped). On PPV and Tips each card carries one small line with the amount,
 * which is money and so stays exact, and on PPV how many unlocked it, which is
 * a counter and so reads short. Twin of web's TrendingEarned.
 */
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { DhbCoin } from "../common/DhbCoin";
import { EXPLORE_GUTTER } from "./ExploreSection";
import { appLocale } from "../../libs/date.util";
import type { UnifiedFeedItem } from "../../services/feed.unified.service";

export type TrendSort = "reactions" | "ppv" | "tips";

export const TREND_SORTS: TrendSort[] = ["reactions", "ppv", "tips"];

const LABEL_KEY: Record<TrendSort, string> = {
  reactions: "search.trendReactions",
  ppv: "search.trendPpv",
  tips: "search.trendTips",
};

/** The amount a card earned, as money: exact, never shortened. */
export function formatEarned(amount: number): string {
  return amount.toLocaleString(appLocale(), { maximumFractionDigits: 2 }); // exact-number
}

/** What a card earned under the given tab, or null when the tab ranks reactions. */
export function earnedFor(item: UnifiedFeedItem, sort: TrendSort): { amount: number; unlocks: number; currency: string } | null {
  if (sort === "reactions") return null;
  const amount = Number(sort === "tips" ? item.totalTips : item.ppvEarnings) || 0;
  const unlocks = Number(item.ppvBuyerCount) || 0;
  const currency = sort === "ppv" ? item.streamInfo?.payPerViewTokenSymbol || "DHB" : "DHB";
  return { amount, unlocks, currency };
}

const isDhb = (symbol: string) => /^\$?(dhb|dehub)?$/i.test(symbol.trim());

export const TrendSortWords = memo(function TrendSortWords({
  value,
  onChange,
}: {
  value: TrendSort;
  onChange: (sort: TrendSort) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.words} accessibilityRole="tablist">
      {TREND_SORTS.map((sort) => {
        const active = sort === value;
        return (
          <Pressable
            key={sort}
            onPress={() => onChange(sort)}
            style={styles.word}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            hitSlop={6}
          >
            <Text className={active ? "text-white" : "text-theme-neutrals-500"} style={active ? styles.wordTextOn : styles.wordText}>
              {t(LABEL_KEY[sort])}
            </Text>
            {active ? <View className="bg-white" style={styles.underline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
});

/** One small line above a card: the amount it earned, and on PPV how many unlocked it. */
export const EarnedLine = memo(function EarnedLine({ item, sort, rank }: { item: UnifiedFeedItem; sort: TrendSort; rank: number }) {
  const { t } = useTranslation();
  const earned = earnedFor(item, sort);
  // Every row of an earnings list earned something; a zero is a row from the
  // previous list still on screen for a frame.
  if (!earned || earned.amount <= 0) return null;
  const dhb = isDhb(earned.currency);
  return (
    <View style={styles.line}>
      <Text className="text-theme-neutrals-400" style={styles.rank}>{`#${rank}`}</Text>
      <Text className="text-white" style={styles.amount}>{formatEarned(earned.amount)}</Text>
      {dhb ? <DhbCoin size={13} /> : <Text className="text-white" style={styles.amount}>{earned.currency}</Text>}
      <Text className="text-theme-neutrals-400" style={styles.meta} numberOfLines={1}>
        {sort === "tips" ? t("search.earnedTipped") : `· ${t("search.earnedUnlocks", { count: earned.unlocks })}`}
      </Text>
    </View>
  );
});

/** A friendly line for a week where nothing earned yet, instead of a blank. */
export function EarnedEmpty({ sort }: { sort: TrendSort }) {
  const { t } = useTranslation();
  return (
    <View style={styles.empty}>
      <Text className="text-theme-neutrals-400" style={styles.emptyText}>
        {t(sort === "tips" ? "search.noEarnedTips" : "search.noEarnedPpv")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  words: { flexDirection: "row", gap: 20, marginTop: 2 },
  word: { paddingTop: 4, paddingBottom: 8 },
  wordText: { fontSize: 14, fontWeight: "500" },
  wordTextOn: { fontSize: 14, fontWeight: "600" },
  underline: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, borderRadius: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: EXPLORE_GUTTER, paddingTop: 10, paddingBottom: 4 },
  rank: { fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], marginRight: 2 },
  amount: { fontSize: 12.5, fontWeight: "600", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 12.5, flexShrink: 1 },
  empty: { paddingHorizontal: EXPLORE_GUTTER, paddingTop: 12, paddingBottom: 24 },
  emptyText: { fontSize: 14, lineHeight: 20 },
});
