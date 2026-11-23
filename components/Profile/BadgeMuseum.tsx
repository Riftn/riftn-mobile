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
 * - The sheet lists every step: earned ones lit, locked ones dimmed with a
 *   progress bar ("640 / 1K").
 */
import React, { FC, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import GlassModal from "../ui/GlassModal";
import { useThemeRootStyle } from "../../context/ThemeContext";
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

  if (!data) return null;
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

export default React.memo(MilestoneChips);
