/**
 * Badge Museum (mobile)
 * =====================
 * Milestone badges (Requests c8a73e8c): first 1K views, 50 videos uploaded,
 * 1K followers and so on. The server works out which steps are earned; this
 * draws them as a medal wall. Twin of web's
 * components/app/profile/BadgeMuseum.tsx.
 *
 * The museum is off by default and lives in Settings
 * (components/Settings/BadgeMuseumSection). Only someone who switches "Show
 * Badge Museum on my profile" on gets it on their profile; while it is off the
 * profile shows nothing museum-related to anyone, the owner included
 * (`customs.badgeMuseumVisibility`, enforced by the server).
 *
 * - `MilestoneChips` sits in the chip row beside the name: the three rarest
 *   earned badges. Tapping one opens the museum.
 * - `BadgeMuseumPanel` sits under the follower counts: the three rarest
 *   earned medals on a small podium, and "See all".
 * - `BadgeMuseumSheet` is the museum: the podium, then every other badge as a
 *   medal; locked ones are outlines with a progress ring.
 *
 * Medals take the theme's one accent (white on System, ink on System Light).
 * Greys are written as hsla() so the System Light pass leaves them alone.
 */
import React, { FC, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import GlassModal from "../ui/GlassModal";
import Icon, { type IconName } from "../ui/Icon";
import { useAppTheme, useThemeRootStyle } from "../../context/ThemeContext";
import { earnedByRarity, useMilestones, type Milestone } from "../../hooks/useMilestones";
import { formatCount } from "../../libs/format-count";

/** One glyph per step, so each medal reads apart from its neighbours. */
const ICONS: Record<string, IconName> = {
  views_1k: "Eye",
  views_10k: "TrendingUp",
  views_100k: "Rocket",
  views_1m: "Star",
  videos_10: "Clapperboard",
  videos_50: "Film",
  videos_200: "Trophy",
  followers_100: "UserPlus",
  followers_1k: "Users",
  followers_10k: "Crown",
  likes_1k: "Heart",
  first_live: "Radio",
  live_10h: "Mic",
};
const iconFor = (id: string): IconName => ICONS[id] ?? "Award";

/** "1M views", "50 videos", "First live". */
function nameFor(t: TFunction, m: Pick<Milestone, "id" | "kind" | "goal">): string {
  const value = formatCount(m.goal);
  switch (m.kind) {
    case "views":
      return t("badgeMuseum.name.views", { value });
    case "videos":
      return t("badgeMuseum.name.videos", { value });
    case "followers":
      return t("badgeMuseum.name.followers", { value });
    case "likes":
      return t("badgeMuseum.name.likes", { value });
    case "lives":
      return t("badgeMuseum.name.firstLive");
    case "liveHours":
      return t("badgeMuseum.name.liveHours", { value });
    default:
      return m.id;
  }
}

const progressPct = (m: Milestone) => Math.max(0, Math.min(100, Math.round((m.value / m.goal) * 100)));

type Rgb = [number, number, number];

function hsla([r, g, b]: Rgb, a = 1): string {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    h *= 60;
  }
  return `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${a})`;
}
const mix = (a: Rgb, b: Rgb, p: number): Rgb => a.map((v, i) => Math.round(v * (1 - p) + b[i] * p)) as Rgb;
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

interface MedalInk {
  metal: Rgb;
  on: string;
  line: string;
  empty: string;
  dim: string;
}

/** The theme's one accent as medal metal: white on System, ink on light. */
function useMedalInk(): MedalInk {
  const { accent, isLight, theme } = useAppTheme();
  return useMemo(() => {
    if (isLight) {
      return {
        metal: [28, 28, 34],
        on: "hsla(0, 0%, 100%, 1)",
        line: "hsla(240, 8%, 5%, 0.14)",
        empty: "hsla(240, 8%, 5%, 0.04)",
        dim: "hsla(240, 8%, 5%, 0.4)",
      };
    }
    const chroma = Math.max(...accent) - Math.min(...accent);
    const plain = theme === "system" || theme === "immersive" || theme === "minimal" || chroma < 16;
    return {
      metal: plain ? [246, 246, 249] : mix(accent as Rgb, WHITE, 0.28),
      on: "hsla(250, 25%, 7%, 1)",
      line: "hsla(0, 0%, 100%, 0.14)",
      empty: "hsla(0, 0%, 100%, 0.05)",
      dim: "hsla(0, 0%, 100%, 0.42)",
    };
  }, [accent, isLight, theme]);
}

/** Medals rise into place in reading order; a ring fills as it lands. */
function useRise(index: number | undefined) {
  const v = useRef(new Animated.Value(index === undefined ? 1 : 0)).current;
  useEffect(() => {
    if (index === undefined) return;
    Animated.timing(v, {
      toValue: 1,
      duration: 460,
      delay: index * 45,
      easing: Easing.bezier(0.25, 0.8, 0.25, 1),
      useNativeDriver: true,
    }).start();
  }, [index, v]);
  return {
    opacity: v,
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  };
}

export const Medal: FC<{ m: Milestone; size: number; ring?: boolean; index?: number; ink: MedalInk }> = ({ m, size, ring, index, ink }) => {
  const rise = useRise(index);
  const id = `bm-${m.id}-${size}`;
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  const pct = progressPct(m);
  const glyph = Math.round(size * 0.42);
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" },
        m.earned
          ? { shadowColor: hsla(ink.metal), shadowOpacity: 0.55, shadowRadius: size / 6, shadowOffset: { width: 0, height: 0 } }
          : null,
        rise,
      ]}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        {m.earned ? (
          <>
            <Defs>
              <RadialGradient id={id} cx="35%" cy="28%" r="80%">
                <Stop offset="0" stopColor={hsla(mix(ink.metal, WHITE, 0.45))} />
                <Stop offset="0.46" stopColor={hsla(ink.metal)} />
                <Stop offset="1" stopColor={hsla(mix(ink.metal, BLACK, 0.38))} />
              </RadialGradient>
            </Defs>
            <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
            <Circle cx={size / 2} cy={size / 2} r={size * 0.38} fill="none" stroke="hsla(0, 0%, 100%, 0.42)" strokeWidth={1.5} />
          </>
        ) : (
          <>
            <Circle cx={size / 2} cy={size / 2} r={size / 2 - 0.75} fill={ink.empty} stroke={ink.line} strokeWidth={1.5} />
            {ring ? (
              <>
                <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ink.line} strokeWidth={2.5} />
                {pct > 0 ? (
                  <Circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={hsla(ink.metal)}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeDasharray={`${c} ${c}`}
                    strokeDashoffset={c * (1 - pct / 100)}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  />
                ) : null}
              </>
            ) : null}
          </>
        )}
      </Svg>
      {/* Its own view, so the glyph stacks above the absolutely placed face. */}
      <View>
        <Icon name={iconFor(m.id)} size={glyph} color={m.earned ? ink.on : ink.dim} />
      </View>
    </Animated.View>
  );
};

/** The three rarest earned medals, the rarest raised in the middle. */
export const MedalPodium: FC<{ medals: Milestone[]; sizes: [number, number]; labels?: boolean; stagger?: boolean }> = ({
  medals,
  sizes,
  labels,
  stagger,
}) => {
  const { t } = useTranslation();
  const ink = useMedalInk();
  const { accent, isLight } = useAppTheme();
  const [first, second, third] = medals;
  const slots = [second, first, third].filter((m): m is Milestone => !!m);
  const plinth = labels ? [16, 28, 10] : [5, 10, 3];
  const plinthColor = isLight ? "hsla(240, 8%, 5%, 0.1)" : hsla(mix(accent as Rgb, WHITE, 0.4), 0.22);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: labels ? 14 : 6 }}>
      {slots.map((m) => {
        const place = m === first ? 1 : m === second ? 0 : 2;
        const size = place === 1 ? sizes[1] : sizes[0];
        return (
          <View key={m.id} style={{ alignItems: "center", gap: labels ? 8 : 4 }}>
            <Medal m={m} size={size} ink={ink} index={stagger ? place : undefined} />
            {labels ? (
              <Text className="text-white" numberOfLines={2} style={{ maxWidth: 96, fontSize: 12, lineHeight: 15, fontWeight: "600", textAlign: "center" }}>
                {nameFor(t, m)}
              </Text>
            ) : null}
            <View
              style={{
                width: size + (labels ? 16 : 6),
                height: plinth[place],
                borderTopLeftRadius: labels ? 6 : 2,
                borderTopRightRadius: labels ? 6 : 2,
                backgroundColor: plinthColor,
              }}
            />
          </View>
        );
      })}
    </View>
  );
};

/** Same look as EarlySupporterChip, fill on the inner View for the tone pass. */
const Chip: FC<{ icon: IconName; label: string; a11y: string; onPress: () => void }> = ({ icon, label, a11y, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.7}
    accessibilityRole="button"
    accessibilityLabel={a11y}
    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    onPress={onPress}
  >
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 16,
        paddingHorizontal: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.15)",
        backgroundColor: "rgba(255,255,255,0.10)",
      }}
    >
      <Icon name={icon} size={10} color="#FFFFFF" />
      <Text style={{ color: "#FFFFFF", fontSize: 10, lineHeight: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  </TouchableOpacity>
);

interface MilestoneChipsProps {
  /** Wallet of the person whose profile is on screen. */
  address?: string | null;
  /** True on your own profile: shows the museum chip before anything is earned. */
  own?: boolean;
}

const MilestoneChips: FC<MilestoneChipsProps> = ({ address, own }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useMilestones(address);

  // Off (the default): nothing by the name, for anyone.
  if (!data || data.hidden) return null;
  const top = data.top
    .map((id) => data.milestones.find((m) => m.id === id))
    .filter((m): m is Milestone => !!m);
  if (!top.length && !own) return null;

  const openLabel = t("badgeMuseum.open");

  return (
    <>
      {top.length ? (
        top.map((m) => {
          const name = nameFor(t, m);
          return <Chip key={m.id} icon={iconFor(m.id)} label={name} a11y={`${name}. ${openLabel}`} onPress={() => setOpen(true)} />;
        })
      ) : (
        <Chip icon="Landmark" label={t("badgeMuseum.title")} a11y={openLabel} onPress={() => setOpen(true)} />
      )}
      {open && <BadgeMuseumSheet address={address} onClose={() => setOpen(false)} />}
    </>
  );
};

export const BadgeMuseumSheet: FC<{ address?: string | null; onClose: () => void }> = ({ address, onClose }) => {
  const { t } = useTranslation();
  const rootStyle = useThemeRootStyle();
  const { width } = useWindowDimensions();
  const { isLight } = useAppTheme();
  const ink = useMedalInk();
  const { data } = useMilestones(address);
  const columns = width >= 600 ? 5 : 4;

  const earned = earnedByRarity(data?.milestones ?? []);
  const podium = earned.slice(0, 3);
  // The rest of the wall: earned ones (rarest first), then locked ones closest to done.
  const wall = [
    ...earned.slice(3),
    ...(data?.milestones ?? [])
      .filter((m) => !m.earned)
      .sort((a, b) => b.value / b.goal - a.value / a.goal || a.rarity - b.rarity),
  ];

  return (
    <GlassModal visible onClose={onClose} presentation="bottom" maxHeight="88%">
      <View style={[{ paddingHorizontal: 16, paddingBottom: 28, gap: 12 }, rootStyle]}>
        <View style={{ alignItems: "center", paddingTop: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" }} />
        </View>
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="Landmark" size={20} color="#FFFFFF" />
            <Text className="text-white text-lg font-semibold">{t("badgeMuseum.title")}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 8 }}>
            <Text className="text-white/50 text-xs">
              {data
                ? t("badgeMuseum.summary", { earned: formatCount(data.earned), total: formatCount(data.total) })
                : t("badgeMuseum.loading")}
            </Text>
            {data?.hidden ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon name="EyeOff" size={12} color={isLight ? "hsla(0, 0%, 0%, 0.5)" : "hsla(0, 0%, 100%, 0.5)"} />
                <Text className="text-white/50 text-xs">{t("badgeMuseum.hiddenNote")}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 16 }}>
          {podium.length ? (
            <View style={{ paddingTop: 8 }}>
              <MedalPodium medals={podium} sizes={[64, 80]} labels stagger />
            </View>
          ) : null}
          {wall.length ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                rowGap: 16,
                paddingTop: podium.length ? 16 : 0,
                borderTopWidth: podium.length ? 1 : 0,
                borderTopColor: ink.line,
              }}
            >
              {wall.map((m, i) => (
                <View key={m.id} style={{ width: `${100 / columns}%`, alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
                  <Medal m={m} size={54} ring ink={ink} index={i + 3} />
                  <Text
                    className={m.earned ? "text-white" : "text-white/60"}
                    numberOfLines={2}
                    style={{ fontSize: 12, lineHeight: 15, fontWeight: "600", textAlign: "center" }}
                  >
                    {nameFor(t, m)}
                  </Text>
                  {!m.earned ? (
                    <Text className="text-white/45" style={{ marginTop: -4, fontSize: 10, fontVariant: ["tabular-nums"], textAlign: "center" }}>
                      {t("badgeMuseum.progress", { value: formatCount(m.value), goal: formatCount(m.goal) })}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
        <Text className="text-white/40 text-[11px]" style={{ textAlign: "center" }}>
          {t("badgeMuseum.footer")}
        </Text>
      </View>
    </GlassModal>
  );
};

interface BadgeMuseumPanelProps {
  /** Wallet (or username) of the person whose profile is on screen. */
  address?: string | null;
}

/**
 * Under the profile counts, only when the owner has switched the museum on
 * and earned something: the podium and a way into the full museum.
 */
export const BadgeMuseumPanel: FC<BadgeMuseumPanelProps> = ({ address }) => {
  const { t } = useTranslation();
  const { isLight } = useAppTheme();
  const [open, setOpen] = useState(false);
  const { data } = useMilestones(address);

  if (!data || data.hidden) return null;
  const earned = earnedByRarity(data.milestones);
  if (!earned.length) return null;

  return (
    <View style={{ marginTop: 16 }}>
      <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t("badgeMuseum.open")} onPress={() => setOpen(true)}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 12,
            paddingHorizontal: 12,
            paddingTop: 12,
            paddingBottom: 10,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: isLight ? "hsla(240, 8%, 5%, 0.1)" : "hsla(0, 0%, 100%, 0.1)",
            backgroundColor: isLight ? "hsla(0, 0%, 100%, 0.6)" : "hsla(0, 0%, 100%, 0.04)",
          }}
        >
          <MedalPodium medals={earned.slice(0, 3)} sizes={[40, 50]} stagger />
          <View style={{ marginLeft: "auto", alignItems: "flex-end", paddingBottom: 4, flexShrink: 1 }}>
            <Text className="text-white" style={{ fontSize: 14, fontWeight: "600" }}>{t("badgeMuseum.title")}</Text>
            <Text className="text-white/50" style={{ fontSize: 12, marginTop: 2 }}>
              {t("badgeMuseum.earnedCount", { value: formatCount(earned.length) })} · {t("badgeMuseum.seeAll")}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
      {open && <BadgeMuseumSheet address={address} onClose={() => setOpen(false)} />}
    </View>
  );
};

export default React.memo(MilestoneChips);
