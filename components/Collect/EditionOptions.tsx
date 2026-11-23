/**
 * How many copies a post mints and who earns when copies are sold again. Port
 * of web's EditionOptions: any whole number of copies, the creator's own
 * resale share, plus anyone they split with, 10% at most in total.
 */
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import Icon from "../ui/Icon";
import { useWalletAddress } from "../../hooks/useCommunityAdmin";
import { usersSearch } from "../../services/user.service";
import { DEFAULT_EDITION_SUPPLY, MAX_EDITION_SUPPLY, MAX_ROYALTY_TOTAL_BPS, bpsLabel } from "../../services/collect.service";
import type { EditionChoice } from "../../services/nft.service";
import { formatCount } from "../../libs/format-count";

const OWN_SHARES = [0, 250, 500, 1000];
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

interface Split { address: string; label: string; bps: number }

export function parseCopies(text: string): number | null {
  const n = Number(text.replace(/[\s,._]/g, ""));
  return Number.isInteger(n) && n >= 1 && n <= MAX_EDITION_SUPPLY ? n : null;
}

interface Props {
  onChange: (next: EditionChoice, valid: boolean) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}

export default function EditionOptions({ onChange, disabled, defaultOpen }: Props) {
  const { t } = useTranslation();
  const me = useWalletAddress()?.toLowerCase() ?? null;
  const [open, setOpen] = useState(!!defaultOpen);
  const [copies, setCopies] = useState(String(DEFAULT_EDITION_SUPPLY));
  const [ownBps, setOwnBps] = useState(500);
  const [splits, setSplits] = useState<Split[]>([]);
  const [query, setQuery] = useState("");

  const supply = parseCopies(copies);
  const total = ownBps + splits.reduce((sum, s) => sum + s.bps, 0);
  const valid = supply != null && total <= MAX_ROYALTY_TOTAL_BPS;

  useEffect(() => {
    const royalties = [
      ...(me && ownBps > 0 ? [{ address: me, bps: ownBps }] : []),
      ...splits.filter((s) => s.bps > 0).map((s) => ({ address: s.address, bps: s.bps })),
    ];
    onChange({ supply: supply ?? undefined, royalties }, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supply, ownBps, splits, me, valid]);

  const typed = query.trim();
  const search = useQuery({
    queryKey: ["edition-split-search", typed.toLowerCase()],
    queryFn: () => usersSearch(typed),
    enabled: open && typed.length >= 2 && !isAddress(typed),
    staleTime: 30_000,
  });
  const matches = useMemo(() => {
    if (isAddress(typed)) return [{ address: typed.toLowerCase(), label: `${typed.slice(0, 6)}…${typed.slice(-4)}` }];
    const list = ((search.data as any)?.data?.result ?? []) as { address?: string; username?: string; displayName?: string }[];
    return list
      .slice(0, 5)
      .map((u) => ({ address: String(u.address ?? "").toLowerCase(), label: u.username ? `@${u.username}` : String(u.displayName ?? "") }))
      .filter((u) => isAddress(u.address) && u.address !== me && !splits.some((s) => s.address === u.address));
  }, [typed, search.data, me, splits]);

  return (
    <View style={styles.box} testID="edition-options">
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.head} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("collect.editionTitle", { defaultValue: "Copies and royalties" })}</Text>
          <Text style={[styles.sub, !valid && styles.bad]}>
            {t("collect.editionSummary", { copies: supply ? formatCount(supply) : "-", royalty: bpsLabel(total), defaultValue: "{{copies}} copies · {{royalty}} on resales" })}
          </Text>
        </View>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} color="rgba(255,255,255,0.6)" />
      </Pressable>
      {open ? (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{t("collect.copiesLabel", { defaultValue: "How many copies" })}</Text>
            <TextInput
              value={copies}
              onChangeText={(v) => setCopies(v.replace(/[^\d]/g, ""))}
              keyboardType="number-pad"
              editable={!disabled}
              style={styles.input}
              accessibilityLabel={t("collect.copiesLabel", { defaultValue: "How many copies" })}
            />
            <Text style={[styles.hint, supply == null && styles.bad]}>
              {supply == null
                ? t("collect.copiesInvalid", { defaultValue: "Type a whole number, 1 or more." })
                : supply === 1
                  ? t("collect.copiesOne", { defaultValue: "One of one. Only a single person can own it." })
                  : t("collect.copiesHint", { defaultValue: "Any number you like. Each copy can be bought and sold on its own." })}
            </Text>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{t("collect.yourRoyalty", { defaultValue: "You earn on every resale" })}</Text>
            <View style={styles.chips}>
              {OWN_SHARES.map((bps) => (
                <Pressable key={bps} onPress={() => !disabled && setOwnBps(bps)} style={[styles.chip, ownBps === bps && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: ownBps === bps }}>
                  <Text style={[styles.chipText, ownBps === bps && styles.chipTextActive]}>
                    {bps === 0 ? t("collect.noRoyalty", { defaultValue: "Nothing" }) : bpsLabel(bps)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{t("collect.splitWith", { defaultValue: "Split royalties with people" })}</Text>
            {splits.map((s) => (
              <View key={s.address} style={styles.splitRow}>
                <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>{s.label}</Text>
                <TextInput
                  value={String(s.bps / 100)}
                  onChangeText={(v) => {
                    const pct = Math.max(0, Math.min(10, Number(v.replace(",", ".").replace(/[^\d.]/g, "")) || 0));
                    setSplits((list) => list.map((x) => (x.address === s.address ? { ...x, bps: Math.round(pct * 100) } : x)));
                  }}
                  keyboardType="decimal-pad"
                  style={[styles.input, { width: 64, textAlign: "right" }]}
                  accessibilityLabel={t("collect.shareFor", { name: s.label, defaultValue: "Share for {{name}}" })}
                />
                <Text style={styles.hint}>%</Text>
                <Pressable onPress={() => setSplits((list) => list.filter((x) => x.address !== s.address))} accessibilityRole="button" accessibilityLabel={t("collect.removeSplit", { defaultValue: "Remove" })} hitSlop={8}>
                  <Icon name="X" size={16} color="rgba(255,255,255,0.5)" />
                </Pressable>
              </View>
            ))}
            {splits.length < 7 ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t("collect.splitSearch", { defaultValue: "Username or wallet" })}
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={styles.input}
              />
            ) : null}
            {matches.map((m) => (
              <Pressable
                key={m.address}
                onPress={() => { setSplits((list) => [...list, { address: m.address, label: m.label || m.address, bps: 100 }]); setQuery(""); }}
                style={styles.match}
              >
                <Text style={styles.title} numberOfLines={1}>{m.label || m.address}</Text>
              </Pressable>
            ))}
            <Text style={[styles.hint, total > MAX_ROYALTY_TOTAL_BPS && styles.bad]}>
              {total > MAX_ROYALTY_TOTAL_BPS
                ? t("collect.royaltyTooHigh", { total: bpsLabel(total), defaultValue: "All shares together can be 10% at most. Now {{total}}." })
                : t("collect.royaltyHint", { defaultValue: "Paid automatically each time a copy sells on Riftn. 10% at most in total." })}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.05)", padding: 14, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: "#FFFFFF", fontSize: 14, fontWeight: "500" },
  sub: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 2 },
  label: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  hint: { color: "rgba(255,255,255,0.4)", fontSize: 12 },
  bad: { color: "#FCA5A5" },
  input: { color: "#FFFFFF", fontSize: 14, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(0,0,0,0.3)", paddingHorizontal: 12, paddingVertical: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, height: 30, justifyContent: "center", borderRadius: 15, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  chipActive: { backgroundColor: "#FFFFFF", borderColor: "#FFFFFF" },
  chipText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#000000" },
  splitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  match: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.5)" },
});
