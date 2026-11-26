import React, { useMemo } from "react";
import { Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Svg, { Polyline } from "react-native-svg";
import { PageSection } from "../page/PageKit";
import { IS_APP_STORE_BUILD } from "../../config/storefront";
import { useAppTheme } from "../../context/ThemeContext";
import { withDeHubLanguage } from "../../libs/localized-url";
interface FinanceAccountingDay {
  date: string;
  revenue: Record<string, number>;
  costs: Record<string, number>;
}

interface Source {
  id: string;
  label: string;
  kind: "revenue" | "cost";
  group: string;
  status: "ok" | "partial" | "unavailable";
}
interface FinanceStats {
  ok: true;
  days: FinanceAccountingDay[];
  sources: Source[];
  notes?: string[];
  provenance?: { expenseAllocation?: string };
  taxSplit?: { period: { from: string; to: string }; shared: { usd: number } };
}

const endpoint = "https://riftn.com/api/finance-stats";
const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0);

export default function FinanceSection({ days }: { days: number | null }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language?.split(/[-_]/)[0].toLowerCase() === "tr" ? "tr" : "en";
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const query = useQuery<FinanceStats>({
    queryKey: ["public-finance-stats", language],
    queryFn: async () => {
      const response = await fetch(language === "tr" ? `${endpoint}?lang=tr` : endpoint, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`Finance stats request failed (${response.status})`);
      const body = await response.json();
      if (body?.ok !== true || !Array.isArray(body.days) || !Array.isArray(body.sources)) throw new Error("Unrecognised finance response");
      return body;
    },
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const view = useMemo(() => {
    if (!query.data) return null;
    const all = query.data.days;
    const rows = days == null ? all : all.slice(-days);
    const totals = { revenue: new Map<string, number>(), costs: new Map<string, number>() };
    for (const row of rows) {
      for (const kind of ["revenue", "costs"] as const) {
        for (const [id, value] of Object.entries(row[kind])) totals[kind].set(id, (totals[kind].get(id) ?? 0) + value);
      }
    }
    const buckets = new Map<string, { revenue: number; costs: number; n: number }>();
    for (const row of rows) {
      const key = rows.length > 62 ? row.date.slice(0, 7) : row.date;
      const bucket = buckets.get(key) ?? { revenue: 0, costs: 0, n: 0 };
      bucket.revenue += sum(row.revenue);
      bucket.costs += sum(row.costs);
      bucket.n++;
      buckets.set(key, bucket);
    }
    return { ...totals, chart: [...buckets].map(([date, b]) => ({ date, revenue: b.revenue / b.n, costs: b.costs / b.n })) };
  }, [query.data, days]);
  if (!query.data || !view) return null;
  const chartWidth = Math.max(260, width - 48);
  const height = 140;
  const maximum = Math.max(1, ...view.chart.flatMap(row => [row.revenue, row.costs]));
  const points = (kind: "revenue" | "costs") => view.chart.map((row, index) => `${index / Math.max(1, view.chart.length - 1) * chartWidth},${height - 8 - row[kind] / maximum * (height - 16)}`).join(" ");
  const sources: Source[] = query.data.sources.map(source => source.id === "operations_reinvestment" && source.label === "Estimated operations" ? { ...source, label: t("stats.money.estimatedOperations", { defaultValue: "Estimated operations" }) } : source);
  const unavailable = sources.filter(source => source.status === "unavailable");
  const notes = new Set(query.data.notes ?? []);
  if (query.data.provenance?.expenseAllocation) notes.add(query.data.provenance.expenseAllocation);
  const revenue = [...view.revenue.values()].reduce((a, b) => a + b, 0);
  const costs = [...view.costs.values()].reduce((a, b) => a + b, 0);
  const openLedger = (source: string, tax = false) => Linking.openURL(withDeHubLanguage(
    `https://riftn.com/stats?finance-view=${tax ? "tax" : "ledger"}&finance-source=${encodeURIComponent(source)}`,
    i18n.language || "en",
  ));
  const ink = { color: colors.foreground };
  const mutedInk = { color: colors.mutedForeground };
  const pressedSurface = { backgroundColor: colors.muted };
  return (
    <>
      <PageSection title={t("stats.money.title")}>
        <View style={styles.tiles}>
          <View style={styles.tile}><Text style={[styles.label, mutedInk]}>{t("stats.money.revenue")}</Text><Text style={[styles.amount, ink]}>{usd(revenue)}</Text></View>
          <View style={styles.tile}><Text style={[styles.label, mutedInk]}>{t("stats.money.costs")}</Text><Text style={[styles.amount, ink]}>{usd(costs)}</Text></View>
        </View>
        {/* What holders and stakers were paid reads as a reward for holding:
            not in the App Store build. */}
        {!IS_APP_STORE_BUILD && <Pressable accessibilityRole="link" onPress={() => openLedger("bsc_holder_share", true)} style={({ pressed }) => [styles.shared, pressed && pressedSurface]}>
          <Text style={[styles.label, mutedInk]}>{t("stats.money.profitShared")}</Text>
          <Text style={[styles.amount, ink]}>{query.data.taxSplit ? usd(query.data.taxSplit.shared.usd) : "—"}</Text>
          <Text style={[styles.hint, mutedInk]}>{t("stats.taxSplit.see")}</Text>
        </Pressable>}
        {view.chart.length > 1 && <Svg width={chartWidth} height={height} accessibilityLabel={t("stats.money.chartMonthly")}>
          <Polyline points={points("revenue")} fill="none" stroke={colors.foreground} strokeWidth={2} />
          <Polyline points={points("costs")} fill="none" stroke={colors.mutedForeground} strokeWidth={2} strokeDasharray="4 4" />
        </Svg>}
        <View style={styles.legend}><Text style={[styles.hint, mutedInk]}>{t("stats.money.revenue")}</Text><Text style={[styles.hint, mutedInk]}>{t("stats.money.costs")}</Text></View>
        {!IS_APP_STORE_BUILD && <Text style={[styles.note, mutedInk]}>{t("stats.money.grossBnbSharingNote", { defaultValue: "Revenue includes BNB shared with holders and stakers. Those payments were distributed, not retained by Riftn." })}</Text>}
        {[...notes].map(note => <Text key={note} style={[styles.note, mutedInk]}>{note}</Text>)}
      </PageSection>
      {(["revenue", "cost"] as const).map(kind => <PageSection key={kind} title={t(kind === "revenue" ? "stats.money.inTitle" : "stats.money.outTitle")}>
        {sources.filter(source => source.kind === kind && (source.id !== "operations_reinvestment" || view.costs.has(source.id))).map(source => <Pressable key={source.id} accessibilityRole={kind === "revenue" ? "link" : undefined} onPress={kind === "revenue" ? () => openLedger(source.id, source.id === "bsc_holder_share") : undefined} style={({ pressed }) => [styles.row, pressed && pressedSurface]}>
          <View style={styles.source}><Text style={[styles.sourceLabel, ink]}>{source.label}</Text><Text style={[styles.hint, mutedInk]}>{source.group === "infrastructure" ? t("stats.money.group.infrastructure") : source.group === "tax" ? t("stats.money.group.tax") : ""}</Text></View>
          <Text style={[styles.value, ink]}>{source.status !== "unavailable" ? (source.status === "partial" ? "~" : "") + usd((kind === "revenue" ? view.revenue : view.costs).get(source.id) ?? 0) : t("stats.money.sourceUnavailable")}</Text>
        </Pressable>)}
      </PageSection>)}
      {unavailable.length > 0 && (
        <Text style={[styles.note, styles.availabilityNote, mutedInk]}>
          {t("stats.money.unavailable", { sources: unavailable.map(source => source.label).join(", ") })}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: 12 },
  tile: { flex: 1 },
  shared: { marginVertical: 16 },
  label: { fontSize: 11, textTransform: "uppercase" },
  amount: { fontSize: 24, fontWeight: "700", marginTop: 4 },
  hint: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  note: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  availabilityNote: { marginHorizontal: 16 },
  legend: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 12 },
  source: { flex: 1 },
  sourceLabel: { fontSize: 13 },
  value: { fontSize: 13 },
});
