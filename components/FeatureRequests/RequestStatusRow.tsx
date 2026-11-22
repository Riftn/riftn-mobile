import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../context/ThemeContext";
import { STATUS_LABELS, type FeatureStatus } from "../../hooks/useFeatureRequests";
import { earlyAccessHoursLeft } from "../../libs/early-access";

/**
 * Category, where the request is (Asked > In progress > Shipped) and the
 * owners' progress note. One accent per theme, no status hues; same as web
 * RequestStatusRow. The line fills once, then the current step breathes and a
 * soft light runs on toward Shipped while the work goes on.
 */
const TRACKED: FeatureStatus[] = ["under_review", "planned", "in_progress"];

// Screens are written in the dark palette; System Light flips greys as it
// renders (libs/jsx/tone.js), so these are the dark-theme colours.
const INK = "#EDEDEF";
const MUTED = "rgba(255,255,255,0.68)";
const FAINT = "rgba(255,255,255,0.5)";
const LINE = "rgba(255,255,255,0.16)";

const SEG = 20;
const TRAVEL = Easing.bezier(0.45, 0, 0.1, 1);
const ARRIVE = Easing.bezier(0.25, 0.8, 0.25, 1);

function lift(rgb: readonly number[], white: number): string {
  const c = rgb.map((v) => Math.round(v + (255 - v) * white));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export default function RequestStatusRow({
  status,
  note,
  categoryChip,
  earlyAccessUntil,
  isPoster = false,
}: {
  status: FeatureStatus;
  note: string;
  categoryChip: React.ReactNode;
  /** Shipped with a head start for its poster until this time. */
  earlyAccessUntil?: string | null;
  isPoster?: boolean;
}) {
  const { t } = useTranslation();
  const earlyHours = status === "shipped" || status === "completed" ? earlyAccessHoursLeft(earlyAccessUntil) : null;
  const tracked = TRACKED.includes(status);
  const liveNote = status !== "declined" ? note : "";
  return (
    <View style={s.col}>
      <View style={s.row}>
        {categoryChip}
        {status === "declined" && (
          <View style={s.flat}>
            <View style={s.dot} />
            <Text style={s.flatText}>{t("copy.2ab63e6ced90", STATUS_LABELS.declined)}</Text>
          </View>
        )}
      </View>
      {tracked && <Track status={status} />}
      {earlyHours !== null && (
        <Text style={s.note}>
          {isPoster
            ? t("features.earlyAccess.mine", { defaultValue: "You have this a day early. Everyone else gets it in {{hours}} h.", hours: earlyHours })
            : t("features.earlyAccess.others", { defaultValue: "Its poster is trying this first. Out for everyone in {{hours}} h.", hours: earlyHours })}
        </Text>
      )}
      {!!liveNote && <Text style={s.note}>{liveNote}</Text>}
    </View>
  );
}

function Track({ status }: { status: FeatureStatus }) {
  const { t } = useTranslation();
  const { skin, accent } = useAppTheme();
  const reduced = useReducedMotion();
  // System / Minimal: white (ink on System Light). Canvas themes: their colour, lifted.
  const acc = skin ? lift(accent as unknown as number[], 0.45) : "#FFFFFF";

  const fill = useSharedValue(reduced ? 1 : 0);
  const arrive = useSharedValue(reduced ? 1 : 0);
  const breathe = useSharedValue(1);
  const run = useSharedValue(-1);

  useEffect(() => {
    if (reduced) return;
    fill.value = withDelay(80, withTiming(1, { duration: 520, easing: TRAVEL }));
    arrive.value = withDelay(420, withTiming(1, { duration: 320, easing: ARRIVE }));
    breathe.value = withDelay(
      1200,
      withRepeat(
        withSequence(
          withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      ),
    );
    run.value = withDelay(
      1200,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1440, easing: TRAVEL }),
          withTiming(1, { duration: 960 }),
          withTiming(-1, { duration: 0 }),
        ),
        -1,
      ),
    );
    return () => {
      cancelAnimation(fill);
      cancelAnimation(arrive);
      cancelAnimation(breathe);
      cancelAnimation(run);
    };
  }, [reduced, fill, arrive, breathe, run]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -SEG / 2 + (SEG / 2) * fill.value }, { scaleX: fill.value }],
  }));
  const dotStyle = useAnimatedStyle(() => {
    const b = 0.8 + 0.2 * breathe.value;
    return {
      opacity: (0.3 + 0.7 * arrive.value) * (0.55 + 0.45 * breathe.value),
      transform: [{ scale: (0.4 + 0.6 * arrive.value) * b }],
    };
  });
  const nowTextStyle = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * arrive.value }));
  const runStyle = useAnimatedStyle(() => ({ transform: [{ translateX: run.value * SEG }] }));

  const now =
    status === "under_review"
      ? t("features.track.underReview", "Under review")
      : status === "planned"
        ? t("features.track.planned", "Planned")
        : t("features.track.inProgress", "In progress");

  return (
    <View
      style={s.track}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${t("features.track.label", "Progress")}: ${now}`}
    >
      <View style={s.step}>
        <View style={[s.stepDot, { backgroundColor: MUTED, borderColor: MUTED }]} />
        <Text style={[s.stepText, { color: MUTED }]}>{t("features.track.asked", "Asked")}</Text>
      </View>
      <View style={s.seg}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: MUTED }, fillStyle]} />
      </View>
      <View style={s.step}>
        <Animated.View style={[s.nowDot, { backgroundColor: acc }, dotStyle]} />
        <Animated.Text style={[s.stepText, s.nowText, nowTextStyle]}>{now}</Animated.Text>
      </View>
      <View style={s.seg}>
        {!reduced && <Animated.View style={[s.runner, { backgroundColor: acc }, runStyle]} />}
      </View>
      <View style={s.step}>
        <View style={s.stepDot} />
        <Text style={s.stepText}>{t("features.track.shipped", "Shipped")}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  flat: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: MUTED },
  flatText: { color: INK, fontSize: 11, fontWeight: "600" },
  note: { color: MUTED, fontSize: 12, lineHeight: 17 },
  track: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", rowGap: 6 },
  seg: { width: SEG, height: 1, marginHorizontal: 8, backgroundColor: LINE, overflow: "hidden" },
  runner: { position: "absolute", top: 0, bottom: 0, left: 0, width: SEG / 2, opacity: 0.9, borderRadius: 1 },
  step: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepDot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: FAINT },
  nowDot: { width: 8, height: 8, borderRadius: 4 },
  stepText: { color: FAINT, fontSize: 11, fontWeight: "500" },
  nowText: { color: INK, fontWeight: "600" },
});
