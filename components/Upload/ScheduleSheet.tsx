import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { glowLine } from "../ui/glow";
import { NavigationContext } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { ScreenNames } from "../../navigation/ScreenNames";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import GlassModal from "../ui/GlassModal";
import Icon from "../ui/Icon";
import { appLocale } from "../../libs/date.util";
import { parseWhen } from "../../libs/parseWhen";
import { localWhenPlaceholder, toEnglishWhen } from "../../libs/localWhen";
import { bestTime, toLocalGrid } from "../../libs/fansOnline";
import { getFansOnline } from "../../services/scheduled.service";
import { UserContext } from "../../context/AuthContext";
import { KitButton, useKitColors } from "../page/PageKit";
import { SEARCH_INPUT_CLEAR, useSearchFieldMaterial } from "../../hooks/useSearchFieldMaterial";
import TimeWheel from "./TimeWheel";
import { DripSection, PostSpacingSection } from "./PostSpacingSection";

import { formatCount } from '../../libs/format-count';
export type ScheduleKind = "post" | "live" | "stage" | "message";

interface ScheduleSheetProps {
  visible: boolean;
  onClose: () => void;
  scheduledDate: Date | null;
  onSchedule: (date: Date | null) => void;
  title?: string;
  minimumMinutes?: number;
  /** Words on the tips under the time. Defaults to a post. */
  kind?: ScheduleKind;
  /** Moving something already planned: no "Remove schedule", no Planned link. */
  moving?: boolean;
  /** Messages only: offer "When they're next online" above the clock. */
  onWhenOnline?: () => void;
  /** Posts with several photos: offer "One post each, spaced out". */
  dripCount?: number;
  /** Minutes between the drip's posts, or null for one post with them all. */
  dripGap?: number | null;
  onDripChange?: (gap: number | null) => void;
}

const STEP = 15;
const DAYS_SHOWN = 14;
const DAY_WIDTH = 48;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atMinutes = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** The next quarter hour after `minAhead` minutes from now. */
const firstSlot = (minAhead: number) => {
  const d = new Date(Date.now() + Math.max(minAhead, 0) * 60_000 + 60_000);
  const m = Math.ceil((d.getHours() * 60 + d.getMinutes()) / STEP) * STEP;
  return atMinutes(startOfDay(d), m);
};

/**
 * The "When?" sheet for posts, Lives and Stages, matching web's
 * (dehubweb src/features/post/components/ScheduleSheet.tsx): type a time, tap a
 * pick, or choose a day from the strip and step the time. Page-kit chips and
 * buttons so every theme draws it like the rest of the app.
 */
export default function ScheduleSheet({ visible, onClose, scheduledDate, onSchedule, title, minimumMinutes = 0, kind = "post", moving = false, onWhenOnline, dripCount = 0, dripGap = null, onDripChange }: ScheduleSheetProps) {
  const { t } = useTranslation();
  // Optional: the sheet also opens from modals that sit outside a navigator.
  const navigation = useContext(NavigationContext);
  const c = useKitColors();
  const field = useSearchFieldMaterial();
  const locale = appLocale();
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [minutes, setMinutes] = useState(19 * 60 + 30);
  const [typed, setTyped] = useState("");
  const stripRef = useRef<ScrollView>(null);
  const [showFans, setShowFans] = useState(false);
  const user = useContext(UserContext)?.user as { walletAddress?: string; address?: string } | null | undefined;
  const wallet = (user?.walletAddress || user?.address || "").toLowerCase();

  // When this account's followers usually watch, for "Best time" and the grid.
  const fans = useQuery({
    queryKey: ["fans-online", wallet],
    queryFn: getFansOnline,
    // A message goes to one person, so when the followers are online says nothing.
    enabled: visible && !!wallet && kind !== "message",
    staleTime: 30 * 60_000,
    retry: false,
  });
  const fansGrid = useMemo(() => (fans.data ? toLocalGrid(fans.data.grid) : null), [fans.data]);

  // The sheet stays mounted between opens; re-seed from the prop each time.
  useEffect(() => {
    if (!visible) return;
    const when = scheduledDate ?? firstSlot(Math.max(minimumMinutes, 60));
    setDay(startOfDay(when));
    setMinutes(when.getHours() * 60 + when.getMinutes());
    setTyped("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const earliest = Date.now() + minimumMinutes * 60_000;
  const selectedAt = atMinutes(day, minutes);
  const validTime = selectedAt.getTime() > earliest;

  // Typed in the reader's own language ("cuma 20:00", "2 saat sonra") as well as English.
  const parsed = useMemo(() => (typed.trim() ? parseWhen(typed) ?? parseWhen(toEnglishWhen(typed, locale ?? "en")) : null), [typed, locale]);
  useEffect(() => {
    if (!parsed) return;
    setDay(startOfDay(parsed.at));
    if (parsed.hasTime) setMinutes(parsed.at.getHours() * 60 + parsed.at.getMinutes());
  }, [parsed]);

  const today = startOfDay(new Date());
  const days = useMemo(() => Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, i)), [today.getTime()]);
  const dayIndex = days.findIndex(d => sameDay(d, day));
  useEffect(() => {
    if (!visible || dayIndex < 0) return;
    stripRef.current?.scrollTo({ x: Math.max(0, (dayIndex - 3) * DAY_WIDTH), animated: true });
  }, [visible, dayIndex]);

  const picks = useMemo(() => {
    const now = new Date();
    const nextWeekday = (wd: number) => addDays(today, ((wd - now.getDay() + 7) % 7) || 7);
    const tonight = atMinutes(today, 20 * 60);
    const best = fansGrid ? bestTime(fansGrid, earliest, now) : null;
    const primeToday = atMinutes(today, 19 * 60 + 30);
    const prime = best ?? (primeToday.getTime() > earliest ? primeToday : atMinutes(addDays(today, 1), 19 * 60 + 30));
    const friday = now.getDay() === 5 ? atMinutes(addDays(today, 1), 19 * 60) : atMinutes(nextWeekday(5), 19 * 60);
    return [
      tonight.getTime() > earliest
        ? { id: "tonight", label: t("whenSheet.tonight", { defaultValue: "Tonight" }), at: tonight }
        : { id: "soon", label: t("whenSheet.inAnHour", { defaultValue: "In an hour" }), at: firstSlot(Math.max(minimumMinutes, 60)) },
      { id: "tomorrow", label: t("whenSheet.tomorrow", { defaultValue: "Tomorrow" }), at: atMinutes(addDays(today, 1), 9 * 60) },
      { id: "weekend", label: friday.toLocaleDateString(locale, { weekday: "long" }), at: friday },
      kind === "message"
        ? { id: "monday", label: nextWeekday(1).toLocaleDateString(locale, { weekday: "long" }), at: atMinutes(nextWeekday(1), 9 * 60), prime: false }
        : best
        ? { id: "prime", label: t("whenSheet.bestTime", { defaultValue: "Best time" }), at: prime, prime: true }
        : { id: "prime", label: t("whenSheet.primeTime", { defaultValue: "Prime time" }), at: prime, prime: true },
    ];
  }, [today.getTime(), earliest, locale, minimumMinutes, t, fansGrid, kind]);

  const timeLabel = (d: Date) => d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const dayLabel = (d: Date) => (sameDay(d, today)
    ? t("whenSheet.today", { defaultValue: "Today" })
    : sameDay(d, addDays(today, 1))
      ? t("whenSheet.tomorrow", { defaultValue: "Tomorrow" })
      : d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }));
  const zone = (() => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value ?? "";
    } catch { return ""; }
  })();

  const choose = (at: Date) => {
    setDay(startOfDay(at));
    setMinutes(at.getHours() * 60 + at.getMinutes());
    setTyped("");
  };
  // The wheels move the time within the picked day.
  const pickClock = (total: number) => {
    setMinutes(total);
    setTyped("");
  };

  const handleConfirm = () => {
    if (!validTime) return;
    onSchedule(selectedAt);
    onClose();
  };
  const handleClear = () => {
    onSchedule(null);
    onClose();
  };
  const dripping = !!dripGap && dripCount > 1 && !!onDripChange;

  const kindTip = kind === "live"
    ? t("whenSheet.liveTip", { defaultValue: "Your followers can set a reminder. You start the Live yourself when it is time." })
    : kind === "stage"
      ? t("whenSheet.stageTip", { defaultValue: "It goes on the Upcoming shelf straight away, so people can tap Remind me." })
      : null;

  const chip = (active: boolean) => [styles.pick, { backgroundColor: active ? c.activeBg : c.chipBg, borderWidth: c.isMinimal && !active ? 1 : 0, borderColor: c.hairline }];
  const ink = (active: boolean) => ({ color: active ? c.activeInk : "#FFFFFF" });

  return (
    <GlassModal visible={visible} onClose={onClose} presentation="bottom" maxHeight="92%" blurIntensity={40}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })} style={styles.close}>
          <Icon name="X" size={20} color="rgba(255,255,255,0.7)" />
        </Pressable>
        <Text style={styles.title}>{title ?? t("whenSheet.title", { defaultValue: "When?" })}</Text>
        <View style={styles.close} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {kind === "post" && !moving ? (
          <>
            <PostSpacingSection />
            {dripCount > 1 && onDripChange ? (
              <DripSection count={dripCount} gap={dripGap} onChange={onDripChange} start={validTime ? selectedAt : new Date()} />
            ) : null}
            <View style={styles.divider} />
          </>
        ) : null}
        {kind === "message" && onWhenOnline ? (
          <Pressable
            onPress={() => { onWhenOnline(); onClose(); }}
            accessibilityRole="button"
            testID="when-online-pick"
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          >
            <View style={[chip(false), styles.whenOnline]}>
              <Icon name="Hourglass" size={16} color="#FFFFFF" />
              <View style={styles.whenOnlineText}>
                <Text style={[styles.pickTitle, ink(false)]}>{t("dmSchedule.whenOnline", { defaultValue: "When they're next online" })}</Text>
                <Text style={[styles.pickSub, ink(false)]}>{t("dmSchedule.whenOnlineHint", { defaultValue: "Shows as sent now. It reaches them the next time they open Riftn, and the tick turns double when they read it." })}</Text>
              </View>
            </View>
          </Pressable>
        ) : null}
        <View style={[styles.typeBox, field.surface]}>
          <Icon name="Clock" size={16} color="rgba(255,255,255,0.6)" />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            onFocus={field.onFocus}
            onBlur={field.onBlur}
            placeholder={localWhenPlaceholder(t("whenSheet.typePlaceholder", { defaultValue: 'Type a time, like "fri 8pm" or "in 2 hours"' }), locale ?? "en")}
            placeholderTextColor="rgba(255,255,255,0.45)"
            accessibilityLabel={t("whenSheet.typeLabel", { defaultValue: "Type a time" })}
            style={[styles.typeInput, SEARCH_INPUT_CLEAR]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="done"
          />
        </View>
        {parsed ? (
          <Text style={styles.parsed}>{dayLabel(parsed.at)}{parsed.hasTime ? `, ${timeLabel(parsed.at)}` : ""}</Text>
        ) : typed.trim() ? (
          <Text style={styles.help}>{t("whenSheet.typeHelp", { defaultValue: 'Try "tonight", "tomorrow 9am", "sat noon" or "30 oct 7pm".' })}</Text>
        ) : null}

        <View style={styles.pickGrid}>
          {picks.map(pick => {
            const tooSoon = pick.at.getTime() <= earliest;
            const active = sameDay(pick.at, day) && pick.at.getHours() * 60 + pick.at.getMinutes() === minutes;
            const sub = pick.id === "weekend" || pick.id === "monday"
              ? `${pick.at.toLocaleDateString(locale, { day: "numeric", month: "short" })} · ${timeLabel(pick.at)}`
              : pick.id === "prime" ? `${dayLabel(pick.at)} · ${timeLabel(pick.at)}` : timeLabel(pick.at);
            return (
              <Pressable
                key={pick.id}
                onPress={() => choose(pick.at)}
                disabled={tooSoon}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: tooSoon }}
                style={({ pressed }) => [styles.pickCell, { opacity: tooSoon ? 0.4 : pressed ? 0.8 : 1 }]}
              >
                <View style={chip(active)}>
                  <View style={styles.pickTitleRow}>
                    {pick.prime ? <Icon name="Sparkles" size={13} color={ink(active).color} /> : null}
                    <Text style={[styles.pickTitle, ink(active)]}>{pick.label}</Text>
                  </View>
                  <Text style={[styles.pickSub, ink(active)]}>{sub}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {fansGrid ? (
          <View>
            <Pressable
              onPress={() => setShowFans(v => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showFans }}
              style={styles.fansToggle}
            >
              <View style={styles.fansToggleLabel}>
                <Icon name="Sparkles" size={13} color="rgba(255,255,255,0.75)" />
                <Text style={styles.fansToggleText}>{t("whenSheet.fansOnline", { defaultValue: "When are my fans online?" })}</Text>
              </View>
              <Text style={styles.fansToggleState}>{showFans ? t("whenSheet.hide", { defaultValue: "Hide" }) : t("whenSheet.show", { defaultValue: "Show" })}</Text>
            </Pressable>
            {showFans ? (() => {
              const max = Math.max(1, ...fansGrid.flat());
              return (
                <View style={styles.fansGrid}>
                  {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map(d => (
                    <View key={d.getTime()} style={styles.fansRow}>
                      <Text style={styles.fansDay}>{sameDay(d, today) ? t("whenSheet.today", { defaultValue: "Today" }) : d.toLocaleDateString(locale, { weekday: "short" })}</Text>
                      <View style={styles.fansCells}>
                        {fansGrid[d.getDay()].map((count, hour) => {
                          const at = atMinutes(d, hour * 60);
                          const past = at.getTime() <= earliest;
                          const picked = sameDay(at, day) && minutes === hour * 60;
                          return (
                            <Pressable
                              key={hour}
                              disabled={past}
                              onPress={() => choose(at)}
                              accessibilityRole="button"
                              accessibilityLabel={`${dayLabel(at)} ${timeLabel(at)}: ${formatCount(count)}`}
                              hitSlop={{ top: 2, bottom: 2 }}
                              style={[
                                styles.fansCell,
                                { opacity: past ? 0.05 : 0.12 + 0.88 * (count / max) },
                                picked && styles.fansCellPicked,
                              ]}
                            />
                          );
                        })}
                      </View>
                    </View>
                  ))}
                  <View style={styles.fansHours}>
                    <Text style={styles.fansHour}>{timeLabel(atMinutes(today, 0))}</Text>
                    <Text style={styles.fansHour}>{timeLabel(atMinutes(today, 12 * 60))}</Text>
                    <Text style={styles.fansHour}>{timeLabel(atMinutes(today, 23 * 60))}</Text>
                  </View>
                  <Text style={styles.fansBasis}>
                    {fans.data?.basis === "followers"
                      ? t("whenSheet.fansBasis", { defaultValue: "Brighter means more of your followers were watching, last {{count}} days.", count: fans.data.days })
                      : t("whenSheet.everyoneBasis", { defaultValue: "Not enough follower activity yet, so this is everyone on Riftn." })}
                  </Text>
                </View>
              );
            })() : null}
          </View>
        ) : null}

        <Text style={styles.eyebrow}>{t("whenSheet.orPickDay", { defaultValue: "Or pick a day" }).toUpperCase()}</Text>
        <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {days.map((d, i) => {
            const active = i === dayIndex;
            return (
              <Pressable
                key={d.getTime()}
                onPress={() => { setDay(d); setTyped(""); }}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.day, { opacity: active ? 1 : 0.55 }]}
              >
                <Text style={styles.dayName}>{i === 0 ? t("whenSheet.today", { defaultValue: "Today" }) : d.toLocaleDateString(locale, { weekday: "short" })}</Text>
                <Text style={[styles.dayNum, active && styles.dayNumActive]}>{d.getDate()}</Text>
                {/* "Beam", as on profile tabs: a short glowing line under the pick. */}
                {active ? <View pointerEvents="none" style={[styles.beam, glowLine("#fff")]} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Spin the hour and the minutes, like the iPhone clock. */}
        <TimeWheel minutes={minutes} onChange={pickClock} locale={locale ?? undefined} />

        {!validTime ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: "#FBBF24" }]}>
            {minimumMinutes > 0
              ? t("whenSheet.tooSoonMin", { defaultValue: "Pick a time at least {{count}} minutes from now.", count: minimumMinutes })
              : t("whenSheet.tooSoon", { defaultValue: "Pick a time in the future." })}
          </Text>
        ) : (
          <Text style={styles.note}>{t("whenSheet.zone", { defaultValue: "Your time ({{zone}}). Everyone else sees it in their own time.", zone })}</Text>
        )}
        {kindTip ? <Text style={styles.note}>{kindTip}</Text> : null}

        <View style={styles.actions}>
          <KitButton
            label={dripping
              ? t("postSpacing.planFrom", { defaultValue: "Plan {{count}} posts from {{when}}", count: dripCount, when: `${dayLabel(day)}, ${timeLabel(selectedAt)}` })
              : t("whenSheet.scheduleFor", { defaultValue: "Schedule for {{when}}", when: `${dayLabel(day)}, ${timeLabel(selectedAt)}` })}
            onPress={handleConfirm}
            disabled={!validTime}
          />
          {dripping ? <KitButton variant="quiet" label={t("postSpacing.startNow", { defaultValue: "Start now" })} onPress={handleClear} /> : null}
          {scheduledDate && !moving ? <KitButton variant="quiet" label={t("whenSheet.remove", { defaultValue: "Remove schedule" })} onPress={handleClear} /> : null}
          {!moving && navigation && kind !== "message" ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                onClose();
                navigation.navigate(ScreenNames.Planned as never);
              }}
              style={styles.plannedLink}
            >
              <Text style={styles.plannedLinkText}>{t("planned.seeAll", { defaultValue: "See everything you have planned" })}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </GlassModal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10 },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  body: { paddingHorizontal: 16, paddingBottom: 20, gap: 14 },
  typeBox: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, borderRadius: 10, paddingHorizontal: 12 },
  typeInput: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "500", paddingVertical: 0 },
  parsed: { color: "#FFFFFF", fontSize: 12, fontWeight: "600", marginTop: -6 },
  help: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: -6 },
  plannedLink: { alignSelf: "center", paddingVertical: 6 },
  plannedLinkText: { color: "rgba(255,255,255,0.55)", fontSize: 12 },
  pickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pickCell: { width: "48.5%" },
  pick: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  pickTitleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  pickTitle: { fontSize: 14, fontWeight: "600" },
  pickSub: { fontSize: 12, fontWeight: "500", opacity: 0.7 },
  whenOnline: { flexDirection: "row", alignItems: "center", gap: 12 },
  whenOnlineText: { flex: 1, gap: 2 },
  eyebrow: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "600", letterSpacing: 1.3, marginBottom: -6 },
  strip: { gap: 4 },
  day: { width: DAY_WIDTH - 4, alignItems: "center", paddingTop: 6, paddingBottom: 10, gap: 2 },
  dayName: { color: "#FFFFFF", fontSize: 11, fontWeight: "500" },
  dayNum: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },
  dayNumActive: { fontWeight: "800" },
  beam: { position: "absolute", bottom: 2, left: "30%", right: "30%", height: 3, borderRadius: 3 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.12)" },
  note: { color: "rgba(255,255,255,0.6)", fontSize: 12, textAlign: "center", marginTop: -6 },
  actions: { gap: 8, marginTop: 4 },
  fansToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  fansToggleLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  fansToggleText: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "600" },
  fansToggleState: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "600" },
  fansGrid: { marginTop: 8, gap: 3 },
  fansRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  fansDay: { width: 36, color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "500" },
  fansCells: { flex: 1, flexDirection: "row", gap: 2 },
  fansCell: { flex: 1, height: 16, borderRadius: 3, backgroundColor: "#FFFFFF" },
  fansCellPicked: { borderWidth: 1, borderColor: "#FFFFFF", opacity: 1 },
  fansHours: { flexDirection: "row", justifyContent: "space-between", paddingLeft: 42 },
  fansHour: { color: "rgba(255,255,255,0.45)", fontSize: 10 },
  fansBasis: { color: "rgba(255,255,255,0.5)", fontSize: 11, paddingTop: 4 },
});
