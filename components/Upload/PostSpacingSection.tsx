import React, { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Icon from "../ui/Icon";
import CustomSwitch from "../ui/CustomSwitch";
import { useKitColors } from "../page/PageKit";
import { UserContext } from "../../context/AuthContext";
import { appLocale } from "../../libs/date.util";
import { toastError } from "../../libs/toast";
import { DRIP_CHOICES, dripTimes, gapLabel } from "../../libs/post-spacing";
import { SPACING_CHOICES, getPostSpacing, savePostSpacing, type PostSpacing } from "../../services/scheduled.service";

export const POST_SPACING_KEY = "post-spacing";

/** The saved "Space my posts" gap for the signed-in account (composer chip + When? sheet). */
export function usePostSpacing(enabled = true) {
  const user = useContext(UserContext)?.user as { walletAddress?: string; address?: string } | null | undefined;
  const wallet = (user?.walletAddress || user?.address || "").toLowerCase();
  return useQuery<PostSpacing>({
    queryKey: [POST_SPACING_KEY, wallet],
    queryFn: getPostSpacing,
    enabled: enabled && !!wallet,
    staleTime: 30_000,
    retry: false,
  });
}

const timeLabel = (d: Date, locale?: string | null) => d.toLocaleTimeString(locale ?? undefined, { hour: "numeric", minute: "2-digit" });

function whenLabel(d: Date, t: (k: string, o?: Record<string, unknown>) => string, locale?: string | null) {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return t("postSpacing.todayAt", { defaultValue: "today at {{time}}", time: timeLabel(d, locale) });
  if (d.toDateString() === tomorrow.toDateString()) return t("postSpacing.tomorrowAt", { defaultValue: "tomorrow at {{time}}", time: timeLabel(d, locale) });
  return `${d.toLocaleDateString(locale ?? undefined, { weekday: "short", day: "numeric", month: "short" })}, ${timeLabel(d, locale)}`;
}

function useChip() {
  const c = useKitColors();
  return {
    box: (active: boolean) => [styles.chip, { backgroundColor: active ? c.activeBg : c.chipBg, borderWidth: c.isMinimal && !active ? 1 : 0, borderColor: c.hairline }],
    ink: (active: boolean) => ({ color: active ? c.activeInk : "#FFFFFF" }),
  };
}

/**
 * "Space my posts" in the When? sheet (Requests 86e8907b), as on web: one
 * switch and a gap, saved on the account so web, app and the assistant agree.
 */
export function PostSpacingSection() {
  const { t } = useTranslation();
  const locale = appLocale();
  const queryClient = useQueryClient();
  const user = useContext(UserContext)?.user as { walletAddress?: string; address?: string } | null | undefined;
  const wallet = (user?.walletAddress || user?.address || "").toLowerCase();
  const chip = useChip();
  const spacing = usePostSpacing(true);
  const queryKey = [POST_SPACING_KEY, wallet] as const;
  const save = useMutation({
    mutationFn: savePostSpacing,
    scope: { id: `${POST_SPACING_KEY}:${wallet}` },
    onSuccess: async (next) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, next);
    },
    onError: () => toastError(t("postSpacing.saveFailed", { defaultValue: "Could not save that. Try again." })),
  });
  if (!wallet) return null;

  const controlsDisabled = spacing.isLoading || save.isPending;
  const data = save.isPending && save.variables !== undefined
    ? { ...(spacing.data ?? { nextAt: null, waiting: 0 }), gapMinutes: save.variables }
    : spacing.data;
  const gap = data?.gapMinutes ?? 0;
  const on = gap > 0;
  const nextAt = data?.nextAt ? new Date(data.nextAt) : null;

  return (
    <View style={styles.section} testID="post-spacing">
      <View style={styles.row}>
        <Icon name="AlignLeft" size={16} color="rgba(255,255,255,0.7)" />
        <View style={styles.rowText}>
          <Text style={styles.title}>{t("postSpacing.title", { defaultValue: "Space my posts" })}</Text>
          {!on ? <Text style={styles.sub}>{t("postSpacing.offHint", { defaultValue: "Each post waits its turn after your last one." })}</Text> : null}
        </View>
        <CustomSwitch
          value={on}
          disabled={controlsDisabled}
          accessibilityLabel={t("postSpacing.title", { defaultValue: "Space my posts" })}
          onValueChange={(v) => save.mutate(v ? (gap || 60) : 0)}
        />
      </View>
      {on ? (
        <>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {SPACING_CHOICES.map((g) => (
              <Pressable
                key={g}
                disabled={controlsDisabled}
                onPress={() => g !== gap && save.mutate(g)}
                accessibilityRole="radio"
                accessibilityState={{ selected: g === gap, disabled: controlsDisabled }}
              >
                <View style={chip.box(g === gap)}>
                  <Text style={[styles.chipText, chip.ink(g === gap)]}>{gapLabel(g, t)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sub}>
            {nextAt
              ? t("postSpacing.hintNext", { defaultValue: "Each post goes out {{gap}} after your last one. Your next post goes out {{when}}.", gap: gapLabel(gap, t), when: whenLabel(nextAt, t, locale) })
              : t("postSpacing.hintNow", { defaultValue: "Your next post goes out straight away, then each one waits {{gap}} after the last.", gap: gapLabel(gap, t) })}
            {(data?.waiting ?? 0) > 0 ? ` ${t("postSpacing.waiting", { defaultValue: "{{count}} waiting in Planned.", count: data!.waiting })}` : ""}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/** "One post each" for a pick of several photos, spaced out from the time picked (or now). */
export function DripSection({ count, gap, onChange, start }: { count: number; gap: number | null; onChange: (gap: number | null) => void; start: Date }) {
  const { t } = useTranslation();
  const locale = appLocale();
  const chip = useChip();
  const times = gap ? dripTimes(start, count, gap) : [];
  const last = times[times.length - 1];
  return (
    <View style={styles.section} testID="post-drip">
      <View style={styles.row}>
        <Icon name="Layers" size={16} color="rgba(255,255,255,0.7)" />
        <Text style={styles.title}>{t("postSpacing.dripTitle", { defaultValue: "{{count}} photos", count })}</Text>
      </View>
      <View style={styles.pair} accessibilityRole="radiogroup">
        <Pressable onPress={() => onChange(null)} accessibilityRole="radio" accessibilityState={{ selected: !gap }} style={styles.half}>
          <View style={[chip.box(!gap), styles.wide]}>
            <Text style={[styles.chipText, chip.ink(!gap)]}>{t("postSpacing.dripOne", { defaultValue: "One post with all {{count}}", count })}</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => onChange(gap || 1440)} accessibilityRole="radio" accessibilityState={{ selected: !!gap }} style={styles.half}>
          <View style={[chip.box(!!gap), styles.wide]}>
            <Text style={[styles.chipText, chip.ink(!!gap)]}>{t("postSpacing.dripEach", { defaultValue: "One post each, spaced out" })}</Text>
          </View>
        </Pressable>
      </View>
      {gap ? (
        <>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {DRIP_CHOICES.map((g) => (
              <Pressable key={g} onPress={() => onChange(g)} accessibilityRole="radio" accessibilityState={{ selected: g === gap }}>
                <View style={chip.box(g === gap)}>
                  <Text style={[styles.chipText, chip.ink(g === gap)]}>
                    {g === 1440 ? t("postSpacing.onceADay", { defaultValue: "Once a day" }) : g === 60 ? t("postSpacing.everyHour", { defaultValue: "Every hour" }) : t("postSpacing.every", { defaultValue: "Every {{gap}}", gap: gapLabel(g, t) })}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
          {last ? (
            <Text style={styles.sub}>
              {t("postSpacing.dripHint", {
                defaultValue: "First one {{first}}, last one {{last}}. Each lands in Planned, where you can move or cancel it.",
                first: start.getTime() <= Date.now() + 60_000 ? t("postSpacing.now", { defaultValue: "now" }) : whenLabel(start, t, locale),
                last: whenLabel(last, t, locale),
              })}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, gap: 2 },
  title: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  sub: { color: "rgba(255,255,255,0.6)", fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 10, paddingHorizontal: 12, height: 32, justifyContent: "center" },
  pair: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },
  wide: { flex: 1, height: undefined, minHeight: 40, paddingVertical: 8 },
  chipText: { fontSize: 12, fontWeight: "600" },
});
