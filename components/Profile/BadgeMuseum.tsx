/**
 * Badge Museum (mobile)
 * =====================
 * Milestone badges on a profile (Requests c8a73e8c): first 1K views, 50
 * videos uploaded, 1K followers and so on. The server works out which steps
 * are earned; this draws them. Twin of web's
 * components/app/profile/BadgeMuseum.tsx.
 *
 * - `MilestoneChips` sits in the chip row beside the name: the three rarest
 *   earned badges, one per kind. Tapping one opens the museum. On your own
 *   profile, with nothing earned yet, one "Badge Museum" chip opens it.
 * - `BadgeMuseumPanel` sits under the follower counts (Requests a63c7686): a
 *   framed panel of every earned badge as hexagon tiles, six to a row on a
 *   phone. Locked steps stay out of it; tapping a tile or the title opens the
 *   museum. Nothing renders until something is earned.
 * - The sheet lists every step: earned ones lit, locked ones dimmed with a
 *   progress bar ("640 / 1K").
 *
 * The owner can hide all of it from other people in Edit profile (Requests
 * f493327b, `customs.badgeMuseumVisibility`); the server then sends other
 * viewers no badges, and the owner sees a "Hidden from others" note.
 */
import React, { FC, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Svg, { Defs, LinearGradient, Polygon, RadialGradient, Stop } from "react-native-svg";
import GlassModal from "../ui/GlassModal";
import Icon from "../ui/Icon";
import { useAppTheme, useThemeRootStyle } from "../../context/ThemeContext";
import { useMilestones, type Milestone } from "../../hooks/useMilestones";
import { formatCount } from "../../libs/format-count";

/** One icon per step, so each badge reads apart from its neighbours. */
const ICONS: Record<string, string> = {
  views_1k: "👀",
  views_10k: "📈",
  views_100k: "🚀",
  views_1m: "🌟",
  videos_10: "🎬",
  videos_50: "🎞️",
  videos_200: "🏆",
  followers_100: "🤝",
  followers_1k: "🎉",
  followers_10k: "👑",
  likes_1k: "❤️",
  first_live: "📡",
  live_10h: "🎙️",
};
const MUSEUM_ICON = "🏛️";

const iconFor = (id: string) => ICONS[id] ?? "🏅";

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

function hintFor(t: TFunction, m: Milestone): string {
  switch (m.kind) {
    case "views":
      return t("badgeMuseum.hint.views");
    case "videos":
      return t("badgeMuseum.hint.videos");
    case "followers":
      return t("badgeMuseum.hint.followers");
    case "likes":
      return t("badgeMuseum.hint.likes");
    case "lives":
      return t("badgeMuseum.hint.firstLive");
    case "liveHours":
      return t("badgeMuseum.hint.liveHours");
    default:
      return "";
  }
}

/** Same look as EarlySupporterChip, fill on the inner View for the tone pass. */
const Chip: FC<{ icon: string; label: string; a11y: string; onPress: () => void }> = ({ icon, label, a11y, onPress }) => (
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
      <Text style={{ fontSize: 10, lineHeight: 12 }}>{icon}</Text>
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

  if (!data || (data.hidden && !own)) return null;
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
        <Chip icon={MUSEUM_ICON} label={t("badgeMuseum.title")} a11y={openLabel} onPress={() => setOpen(true)} />
      )}
      {open && <BadgeMuseumSheet address={address} onClose={() => setOpen(false)} />}
    </>
  );
};

const BadgeMuseumSheet: FC<{ address?: string | null; onClose: () => void }> = ({ address, onClose }) => {
  const { t } = useTranslation();
  const rootStyle = useThemeRootStyle();
  const { width } = useWindowDimensions();
  const { data } = useMilestones(address);
  const columns = width >= 600 ? 3 : 2;

  // Earned first (rarest first), then locked ones closest to done.
  const rows = [...(data?.milestones ?? [])].sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;
    if (a.earned) return b.rarity - a.rarity;
    return b.value / b.goal - a.value / a.goal || a.rarity - b.rarity;
  });

  return (
    <GlassModal visible onClose={onClose} presentation="bottom" maxHeight="85%">
      <View style={[{ paddingHorizontal: 16, paddingBottom: 28, gap: 12 }, rootStyle]}>
        <View style={{ alignItems: "center", paddingTop: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" }} />
        </View>
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 18 }}>{MUSEUM_ICON}</Text>
            <Text className="text-white text-lg font-semibold">{t("badgeMuseum.title")}</Text>
          </View>
          <Text className="text-white/50 text-xs">
            {data
              ? t("badgeMuseum.summary", { earned: formatCount(data.earned), total: formatCount(data.total) })
              : t("badgeMuseum.loading")}
          </Text>
          {data?.hidden ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="EyeOff" size={12} color="hsla(0, 0%, 100%, 0.5)" />
              <Text className="text-white/50 text-xs">{t("badgeMuseum.hiddenNote")}</Text>
            </View>
          ) : null}
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {rows.map((m) => (
            <Tile key={m.id} m={m} t={t} columns={columns} />
          ))}
        </ScrollView>
        <Text className="text-white/40 text-[11px]" style={{ textAlign: "center" }}>
          {t("badgeMuseum.footer")}
        </Text>
      </View>
    </GlassModal>
  );
};

const Tile: FC<{ m: Milestone; t: TFunction; columns: number }> = ({ m, t, columns }) => {
  const pct = Math.max(0, Math.min(100, Math.round((m.value / m.goal) * 100)));
  return (
    <View
      style={{
        width: columns === 3 ? "31.5%" : "48%",
        flexGrow: 1,
        alignItems: "center",
        gap: 6,
        padding: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: m.earned ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.08)",
        backgroundColor: m.earned ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: m.earned ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
        }}
      >
        <Text style={{ fontSize: 24, opacity: m.earned ? 1 : 0.35 }}>{iconFor(m.id)}</Text>
      </View>
      <Text className={m.earned ? "text-white text-sm font-semibold" : "text-white/60 text-sm font-semibold"} style={{ textAlign: "center" }}>
        {nameFor(t, m)}
      </Text>
      <Text className="text-white/45 text-[11px]" style={{ textAlign: "center" }}>
        {hintFor(t, m)}
      </Text>
      {m.earned ? (
        <View
          style={{
            marginTop: "auto",
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.15)",
            backgroundColor: "rgba(255,255,255,0.06)",
          }}
        >
          <Text className="text-white/80 text-[10px] font-semibold">{t("badgeMuseum.earned")}</Text>
        </View>
      ) : (
        <View style={{ marginTop: "auto", width: "100%", gap: 4 }}>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: pct }}
            style={{ height: 6, width: "100%", borderRadius: 3, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)" }}
          >
            <View style={{ height: "100%", width: `${pct}%`, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.6)" }} />
          </View>
          <Text className="text-white/50 text-[10px]" style={{ textAlign: "center", fontVariant: ["tabular-nums"] }}>
            {t("badgeMuseum.progress", { value: formatCount(m.value), goal: formatCount(m.goal) })}
          </Text>
        </View>
      )}
    </View>
  );
};

/**
 * One colour per kind, so a row of tiles reads as families at a glance. Hue
 * and saturation only; lightness is set per layer below.
 */
const KIND_HUE: Record<string, number> = {
  views: 205,
  videos: 270,
  followers: 150,
  likes: 335,
  lives: 12,
  liveHours: 42,
};

const HEX_OUTER = "45,0 90,25 90,75 45,100 0,75 0,25";
const HEX_INNER = "45,5 86,27.5 86,72.5 45,95 4,72.5 4,27.5";

/** A hexagon tile in the badge's family colour with its icon in the middle. */
const HexBadge: FC<{ m: Milestone; size: number }> = ({ m, size }) => {
  const hue = KIND_HUE[m.kind] ?? 220;
  const id = `bm-${m.id}`;
  const height = size / 0.9;
  return (
    <View
      style={{
        width: size,
        height,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: `hsl(${hue}, 90%, 60%)`,
        shadowOpacity: 0.5,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 0 },
      }}
    >
      <Svg width={size} height={height} viewBox="0 0 90 100" style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id={`${id}-rim`} x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor={`hsl(${hue}, 85%, 66%)`} />
            <Stop offset="1" stopColor={`hsl(${hue}, 70%, 38%)`} />
          </LinearGradient>
          <RadialGradient id={`${id}-core`} cx="50%" cy="35%" r="70%">
            <Stop offset="0" stopColor={`hsl(${hue}, 70%, 34%)`} />
            <Stop offset="1" stopColor={`hsl(${hue}, 60%, 14%)`} />
          </RadialGradient>
        </Defs>
        <Polygon points={HEX_OUTER} fill={`url(#${id}-rim)`} />
        <Polygon points={HEX_INNER} fill={`url(#${id}-core)`} />
      </Svg>
      <Text style={{ fontSize: Math.round(size * 0.4), lineHeight: Math.round(size * 0.5) }}>{iconFor(m.id)}</Text>
    </View>
  );
};

interface BadgeMuseumPanelProps {
  /** Wallet (or username) of the person whose profile is on screen. */
  address?: string | null;
  /** True on your own profile: shows the "Hidden from others" note when it applies. */
  own?: boolean;
}

/**
 * Every earned badge, in a framed panel under the profile counts. Six to a
 * row on a phone, eight on a tablet; a short last row sits centred.
 */
export const BadgeMuseumPanel: FC<BadgeMuseumPanelProps> = ({ address, own }) => {
  const { t } = useTranslation();
  const { accent, isLight } = useAppTheme();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [innerWidth, setInnerWidth] = useState(0);
  const { data } = useMilestones(address);

  if (!data || (data.hidden && !own)) return null;
  const earned = data.milestones.filter((m) => m.earned).sort((a, b) => b.rarity - a.rarity);
  if (!earned.length) return null;

  const columns = width >= 600 ? 8 : 6;
  const cell = innerWidth > 0 ? innerWidth / columns : 0;
  const hexSize = Math.min(56, Math.max(30, cell - 10));
  const [r, g, b] = accent;
  const rim = `rgba(${r},${g},${b},0.5)`;
  const glow = `rgb(${r},${g},${b})`;
  const title = t("badgeMuseum.title");
  const openLabel = t("badgeMuseum.open");

  return (
    <View style={{ marginTop: 20, paddingTop: 12 }}>
      <View
        style={{
          borderRadius: 18,
          borderWidth: 1,
          borderColor: rim,
          backgroundColor: isLight ? "hsla(0, 0%, 100%, 0.55)" : "hsla(0, 0%, 100%, 0.03)",
          paddingTop: 20,
          paddingBottom: 12,
          paddingHorizontal: 8,
          shadowColor: glow,
          shadowOpacity: 0.45,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <View
          onLayout={(e) => setInnerWidth(e.nativeEvent.layout.width)}
          style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", rowGap: 10 }}
        >
          {cell > 0 &&
            earned.map((m) => {
              const name = nameFor(t, m);
              return (
                <TouchableOpacity
                  key={m.id}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${name}. ${openLabel}`}
                  onPress={() => setOpen(true)}
                  style={{ width: cell }}
                >
                  <View style={{ alignItems: "center", gap: 4, paddingHorizontal: 2 }}>
                    <HexBadge m={m} size={hexSize} />
                    <Text
                      numberOfLines={2}
                      className="text-white/75"
                      style={{ fontSize: 9.5, lineHeight: 12, fontWeight: "600", textAlign: "center" }}
                    >
                      {name}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
        </View>
        {own && data.hidden ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 10 }}>
            <Icon name="EyeOff" size={12} color={isLight ? "hsla(0, 0%, 0%, 0.5)" : "hsla(0, 0%, 100%, 0.5)"} />
            <Text className="text-white/50" style={{ fontSize: 11 }}>{t("badgeMuseum.hiddenNote")}</Text>
          </View>
        ) : null}
      </View>
      {/* The title sits in a notch on the frame's top edge. */}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, alignItems: "center" }} pointerEvents="box-none">
        <TouchableOpacity activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={openLabel} onPress={() => setOpen(true)}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 4,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: `rgba(${r},${g},${b},0.6)`,
              backgroundColor: isLight ? "hsla(40, 20%, 97%, 1)" : "hsla(240, 10%, 4%, 1)",
              shadowColor: glow,
              shadowOpacity: 0.5,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 0 },
            }}
          >
            <Text style={{ fontSize: 12 }}>🏆</Text>
            <Text className="text-white" style={{ fontSize: 12, fontWeight: "600" }}>{title}</Text>
            <Text className="text-white/50" style={{ fontSize: 10, fontVariant: ["tabular-nums"] }}>{formatCount(earned.length)}</Text>
          </View>
        </TouchableOpacity>
      </View>
      {open && <BadgeMuseumSheet address={address} onClose={() => setOpen(false)} />}
    </View>
  );
};

export default React.memo(MilestoneChips);
