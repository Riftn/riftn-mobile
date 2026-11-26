/**
 * SuperPowersScreen
 * =================
 * What a badge buys beyond the art next to your name. Your tier, the boosts it
 * grants this cycle, what you have spent them on, and the whole thirteen-rung
 * ladder lit against where you stand.
 *
 * Native port of web's `/app/superpowers`. Same two rules the web page follows:
 *
 * **It reads signed out and badgeless.** Somebody who has not staked is the
 * whole audience for this screen — greeting them with "connect a wallet" tells
 * them nothing about why they would want to. The ladder comes from the public
 * endpoint; only the allowance panel needs an account.
 *
 * All twelve powers are listed in unlock order. Great White Shark remains a badge
 * tier with a stronger allowance, but it does not add a separate power.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../components/ui/Icon";
import ScreenHeader from "../components/ScreenHeader";
import { KitButton, PageEmpty, PageSection, ThemeIcon } from "../components/page/PageKit";
import { badgeImage } from "../libs";
import { BadgeProgress } from "../components/Badge/BadgeProgress";
import {
  useCancelBoost,
  useSuperpowerLadder,
  useSuperpowers,
} from "../hooks/useSuperpowers";
import { toastError, toastSuccess } from "../libs";
import { useUser } from "../context/AuthContext";
import SpendPowerSheet from "../components/common/SpendPowerSheet";
import TeamUpSheet from "../components/common/TeamUpSheet";
import GlassModal from "../components/ui/GlassModal";
import {
  type SuperPowerInfo,
} from "../services/superpower.service";
import SuperPowerIcon from "../components/common/SuperPowerIcon";
import SuperPowersOrbit, { type OrbitPower } from "../components/superpowers/SuperPowersOrbit";
import BuyDhbSheet from "../components/Dpay/BuyDhbSheet";
import { DIGITAL_PURCHASES_ENABLED } from "../config/storefront";
import { systemColors } from "../theme/colors";

/** Total slot minutes a tier holds per cycle — the number worth comparing. */
function formatMinutes(total: number): string {
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export default function SuperPowersScreen() {
  const { t, i18n } = useTranslation();
  const {
    data: status,
    isLoading: loadingStatus,
    isError: statusFailed,
    refetch: refetchStatus,
  } = useSuperpowers();
  const { data: ladder, isLoading: loadingLadder } = useSuperpowerLadder();
  const cancelBoost = useCancelBoost();

  // The public ladder carries every power; the signed-in one adds `unlocked`.
  // Prefer the personal copy so the screen lights up without a second render.
  const powers = [...(status?.powers ?? ladder?.powers ?? [])]
    .filter(power => String(power.key) !== "golden_hour")
    .sort((a, b) => Number(b.key === "team_up") - Number(a.key === "team_up"));

  const refillsOn = useMemo(() => {
    const iso = status?.cycleEndsAt ?? ladder?.cycleEndsAt;
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(i18n.language?.replace('_', '-'), { day: "numeric", month: "long" });
  }, [status?.cycleEndsAt, ladder?.cycleEndsAt, i18n.language]);

  // One sheet for every spendable power. It resolves the target a power needs — a
  // post, a comment, a Stage, a category — and books it; the server re-checks
  // every one of those, so this only decides what is worth offering.
  const user = useUser();
  const myAddress = (user?.walletAddress || user?.address || null) as string | null;
  const [spending, setSpending] = useState<SuperPowerInfo | null>(null);
  const [historyPower, setHistoryPower] = useState<SuperPowerInfo | null>(null);
  const [teamUpOpen, setTeamUpOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);

  const { width } = useWindowDimensions();
  const orbitSize = Math.min(width - 24, 440);

  // Team up is public; every other power is held when the account's tier
  // reaches it. The public ladder has no `unlocked`, so signed out it is dim.
  const orbitPowers: OrbitPower[] = powers.map(power => ({
    power,
    unlocked: power.key === "team_up" || !!power.unlocked,
  }));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Until a power is tapped, open on the first one this account can spend now,
  // so the panel starts on an action rather than a lock.
  const selected =
    orbitPowers.find(entry => entry.power.key === selectedKey) ??
    orbitPowers.find(entry => entry.unlocked && entry.power.available && entry.power.key !== "team_up") ??
    orbitPowers[0] ??
    null;

  const ladderTiers = (ladder?.tiers ?? []).filter(
    (tier): tier is typeof tier & { name: string } => !!tier.name,
  );
  const myTierIndex = ladderTiers.findIndex(tier => tier.name === status?.tier);

  const historyBookings = historyPower
    ? (status?.bookings.filter(booking => booking.power === historyPower.key) ?? [])
    : [];

  const handleCancel = (id: string) =>
    cancelBoost.mutate(id, {
      onSuccess: ({ refunded }) =>
        toastSuccess(
          refunded
            ? t("superpowers.boostCancelledRefunded")
            : t("superpowers.boostCancelledSpent"),
        ),
      onError: (error: any) => toastError(error?.message || t("superpowers.cancelFailed")),
    });

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={t("superpowers.screenTitle")}
        subtitle={t("superpowers.screenSubtitle")}
        icon="superpowers"
      />

      <ScrollView contentContainerStyle={styles.content}>
        {DIGITAL_PURCHASES_ENABLED ? (
          <Text style={styles.intro}>{t("superpowers.intro")}</Text>
        ) : null}

        {/* ── The orbit ────────────────────────────────────────────────── */}
        <SuperPowersOrbit
          size={orbitSize}
          powers={orbitPowers}
          selectedKey={selected?.power.key ?? null}
          onSelect={power => setSelectedKey(power.key)}
          core={
            loadingStatus ? (
              <ActivityIndicator color="#fff" />
            ) : status?.tier ? (
              <>
                {badgeImage(status.tier) ? (
                  <Image source={badgeImage(status.tier)} style={{ width: orbitSize * 0.2, height: orbitSize * 0.2 }} resizeMode="contain" />
                ) : null}
                <Text style={styles.coreTier} numberOfLines={1}>{status.tier}</Text>
                <Text style={styles.coreBig} numberOfLines={1} adjustsFontSizeToFit>
                  {status.boostsLeft}
                </Text>
                <Text style={styles.coreSub} numberOfLines={2}>
                  {t("superpowers.boostsLeftOf", { left: status.boostsLeft, total: status.boostsPerCycle })}
                  {refillsOn ? ` · ${t("superpowers.refillsShort", { date: refillsOn })}` : ""}
                </Text>
              </>
            ) : (
              <>
                <ThemeIcon icon="superpowers" size={orbitSize * 0.17} />
                <Text style={styles.coreBig} numberOfLines={1}>12</Text>
                <Text style={styles.coreSub} numberOfLines={1}>{t("superpowers.twelvePowers")}</Text>
              </>
            )
          }
        />

        {selected ? (() => {
          const { power, unlocked } = selected;
          const isTeamUp = power.key === "team_up";
          const usable = unlocked && power.available;
          const canViewHistory = !isTeamUp && !!status?.tier;
          const showAction = DIGITAL_PURCHASES_ENABLED && (isTeamUp || usable);
          const unlockBadge = badgeImage(power.tier);
          const allowance =
            power.key === "signal_flare" || power.key === "harpoon"
              ? (status?.signalsLeft ?? status?.boostsLeft)
              : status?.boostsLeft;
          return (
            <View style={styles.detail}>
              <View style={styles.detailTop}>
                <SuperPowerIcon power={power.key} style={[styles.detailIcon, !unlocked && styles.powerIconOff]} />
                <View style={styles.detailText}>
                  <Text style={[styles.detailName, !unlocked && styles.detailNameOff]}>{power.label}</Text>
                  <View style={styles.detailTag}>
                    {isTeamUp ? (
                      <Text style={styles.detailTagText}>
                        {t(DIGITAL_PURCHASES_ENABLED ? "superpowers.openToEveryone" : "storefront.unavailable")}
                      </Text>
                    ) : !power.available ? (
                      <Text style={styles.detailTagText}>{t("screens.comingSoon")}</Text>
                    ) : (
                      <>
                        <Icon name={unlocked ? "Check" : "Lock"} size={11} color={unlocked ? "#D4D4D8" : "#71717A"} />
                        <Text style={styles.detailTagText}>{`${t("superpowers.unlocksAt")} ${power.tier}`}</Text>
                        {unlockBadge ? <Image source={unlockBadge} style={styles.detailBadge} resizeMode="contain" /> : null}
                      </>
                    )}
                  </View>
                </View>
              </View>
              <Text style={styles.detailSummary}>{power.summary}</Text>
              {!isTeamUp && usable && allowance !== undefined ? (
                <Text style={styles.detailUses}>{t("superpowers.usesLeft", { count: allowance })}</Text>
              ) : null}
              {!DIGITAL_PURCHASES_ENABLED && !isTeamUp && usable ? (
                <Text style={styles.detailUses}>{t("storefront.unavailable")}</Text>
              ) : null}
              {canViewHistory || showAction ? (
                <View style={styles.detailActions}>
                  {canViewHistory ? (
                    <KitButton
                      label={t("superpowers.pastUsage")}
                      variant="quiet"
                      onPress={() => { setHistoryPower(power); void refetchStatus(); }}
                    />
                  ) : null}
                  {showAction ? (
                    <KitButton
                      label={isTeamUp ? power.label : t("auth.use")}
                      onPress={() => isTeamUp ? setTeamUpOpen(true) : setSpending(power)}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })() : null}

        {/* ── Your allowance ───────────────────────────────────────────── */}
        <PageSection>
        {loadingStatus ? null : status?.tier ? (
          <BadgeProgress balance={status.badgeBalance} compact />
        ) : statusFailed && !status ? (
          // A failed request is not "no badge". The panel below would show a
          // holder a zero badge balance, and offer DHB where purchases are on.
          <PageEmpty
            title={t("superpowers.loadFailed")}
            action={<KitButton label={t("common.tryAgain")} onPress={() => void refetchStatus()} />}
          />
        ) : (
          // Team up is available without buying tokens or holding a badge.
          <View style={styles.panel}>
            {DIGITAL_PURCHASES_ENABLED ? (
              <Text style={styles.muted}>{t("superpowers.teamUpOpenToAll")}</Text>
            ) : null}
            <BadgeProgress balance={status?.badgeBalance ?? 0} compact />
            {DIGITAL_PURCHASES_ENABLED && <KitButton
              onPress={() => setBuyOpen(true)}
              style={styles.cta}
              label={t("superpowers.getDhb")}
            />}
          </View>
        )}
        </PageSection>

        {/* ── The ladder ───────────────────────────────────────────────── */}
        <PageSection title={t("superpowers.whatEachTierGrants")}>
        {loadingLadder ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {ladderTiers.map((tier, index) => {
              const mine = index === myTierIndex;
              const above = myTierIndex >= 0 && index > myTierIndex;
              const badge = badgeImage(tier.name);
              return (
                <View key={tier.name} style={[styles.rung, mine && styles.rungMine]}>
                  {badge ? <Image source={badge} style={[styles.rungBadge, above && styles.rungBadgeOff]} resizeMode="contain" /> : null}
                  <Text style={[styles.rungName, mine && styles.rungTextMine]} numberOfLines={1}>{tier.name}</Text>
                  <Text style={[styles.rungTotal, mine && styles.rungTextMine]}>
                    {formatMinutes(tier.boostsPerCycle * tier.minutesPerBoost)}
                  </Text>
                  <Text style={styles.rungSplit}>{tier.boostsPerCycle} × {tier.minutesPerBoost}m</Text>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* The honest sentence, once, where the numbers are. */}
        <Text style={[styles.footnote, { marginTop: 12 }]}>{t("superpowers.rotationNote")}</Text>
        </PageSection>
      </ScrollView>

      {/* The App Store view is read-only. The status API combines token-linked
          and granted badge allowances, so it cannot authorize iOS boost or Team Up actions. */}
      {DIGITAL_PURCHASES_ENABLED ? (
        <>
          <BuyDhbSheet visible={buyOpen} onClose={() => setBuyOpen(false)} onDelivered={() => void refetchStatus()} />
          <SpendPowerSheet power={spending} address={myAddress} onClose={() => setSpending(null)} />
          <TeamUpSheet visible={teamUpOpen} onClose={() => setTeamUpOpen(false)} address={myAddress} />
        </>
      ) : null}

      <GlassModal
        visible={!!historyPower}
        onClose={() => setHistoryPower(null)}
        presentation="bottom"
      >
        <View style={styles.historySheet}>
          <View style={styles.historyHeader}>
            <View style={styles.historyHeaderText}>
              <View style={styles.historyTitleRow}>
                {historyPower ? <SuperPowerIcon power={historyPower.key} style={styles.powerIcon} /> : null}
                <Text style={styles.historyTitle}>{t("superpowers.usageTitle", { power: historyPower?.label })}</Text>
              </View>
              <Text style={styles.historySubtitle}>{t("superpowers.usageSubtitle")}</Text>
            </View>
            <Pressable
              onPress={() => setHistoryPower(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Icon name="X" size={18} color="#A1A1AA" />
            </Pressable>
          </View>

          <ScrollView style={styles.historyList} contentContainerStyle={styles.historyListContent}>
            {historyBookings.length === 0 ? (
              <View style={styles.historyEmpty}>
                <Icon name="History" size={25} color="#71717A" />
                <Text style={styles.historyEmptyText}>{t("superpowers.noPastUsage")}</Text>
              </View>
            ) : (
              historyBookings.map(booking => {
                const notificationPower = booking.power === "signal_flare" || booking.power === "harpoon";
                const result = notificationPower
                  ? booking.signalDeliveryStatus === "sent"
                    ? t("superpowers.notified", { count: booking.signalRecipients ?? 0 })
                    : booking.signalDeliveryStatus === "failed"
                      ? t("superpowers.deliveryRetrying")
                      : booking.power === "harpoon"
                        ? t("superpowers.notifyingBadgeHolders")
                        : t("superpowers.notifyingFollowers")
                  : t("superpowers.seen", { count: booking.served });
                const subject = booking.tokenId != null
                  ? t("superpowers.postNumber", { id: booking.tokenId })
                  : booking.category || historyPower?.label || booking.power;

                return (
                  <View key={booking.id} style={styles.historyRow}>
                    <Icon name="Clock" size={16} color="#71717A" />
                    <View style={styles.historySubject}>
                      <Text numberOfLines={1} style={styles.historySubjectText}>{subject}</Text>
                      <Text style={styles.historyDate}>
                        {new Date(booking.startsAt).toLocaleString(i18n.language?.replace('_', '-'), {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    </View>
                    <View style={styles.historyResult}>
                      <Text style={styles.historyResultText}>{result}</Text>
                      {!notificationPower ? (
                        <Text style={styles.historyState}>
                          {booking.live
                            ? t("feed.live")
                            : booking.status === "active"
                              ? t("converter.statusQueued")
                              : t("superpowers.stateFinished")}
                        </Text>
                      ) : null}
                    </View>
                    {DIGITAL_PURCHASES_ENABLED && booking.status === "active" && !notificationPower ? (
                      <Pressable
                        onPress={() => handleCancel(booking.id)}
                        disabled={cancelBoost.isPending}
                        hitSlop={8}
                      >
                        <Text style={styles.cancel}>{t("common.cancel")}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </GlassModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: systemColors.background },
  content: { paddingTop: 4, paddingBottom: 48 },
  intro: { color: systemColors.mutedForeground, fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 12 },
  loading: { paddingVertical: 32, alignItems: "center" },

  panel: { gap: 12 },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  badge: { width: 44, height: 44 },
  tierText: { flex: 1, minWidth: 0 },
  tierName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  muted: { color: systemColors.mutedForeground, fontSize: 12, marginTop: 2 },
  footnote: { color: systemColors.mutedForeground, fontSize: 12, lineHeight: 17 },
  body: { color: "#fff", fontSize: 13, lineHeight: 19 },

  cta: { alignSelf: "flex-start" },

  spendRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  spendCol: { gap: 6 },
  spendText: { flex: 1, minWidth: 0, gap: 2 },
  spendTitle: { color: "#fff", fontSize: 14 },
  spendBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  spendBtnText: { color: "#fff", fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  chip: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipPicked: { borderColor: "rgba(255,255,255,0.4)", backgroundColor: "rgba(255,255,255,0.15)" },
  chipText: { color: "#A1A1AA", fontSize: 11 },
  chipTextPicked: { color: "#fff" },
  cancel: { color: systemColors.mutedForeground, fontSize: 12 },

  heading: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    marginTop: 8,
  },

  coreTier: { color: systemColors.foreground, fontSize: 17, fontWeight: "800", marginTop: 4 },
  coreBig: { color: systemColors.foreground, fontSize: 32, fontWeight: "800", letterSpacing: -1, marginTop: 2 },
  coreSub: { color: systemColors.mutedForeground, fontSize: 11, textAlign: "center", marginTop: 4, lineHeight: 14 },

  detail: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    padding: 16,
    gap: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  detailTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  detailIcon: { width: 52, height: 52 },
  detailText: { flex: 1, minWidth: 0, gap: 4 },
  detailName: { color: systemColors.foreground, fontSize: 18, fontWeight: "700" },
  detailNameOff: { color: "#D4D4D8" },
  detailTag: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  detailTagText: { color: systemColors.mutedForeground, fontSize: 10.5, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" },
  detailBadge: { width: 18, height: 18 },
  detailSummary: { color: systemColors.mutedForeground, fontSize: 13.5, lineHeight: 19 },
  detailUses: { color: systemColors.mutedForeground, fontSize: 11.5, fontVariant: ["tabular-nums"] },
  detailActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },

  rail: { gap: 8, paddingRight: 4 },
  rung: { width: 78, alignItems: "center", gap: 3, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  rungMine: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.06)" },
  rungBadge: { width: 32, height: 32 },
  rungBadgeOff: { opacity: 0.35 },
  rungName: { color: systemColors.mutedForeground, fontSize: 11, fontWeight: "600" },
  rungTotal: { color: systemColors.mutedForeground, fontSize: 12, fontVariant: ["tabular-nums"] },
  rungTextMine: { color: systemColors.foreground },
  rungSplit: { color: systemColors.mutedForeground, fontSize: 11, fontVariant: ["tabular-nums"] },
  powerIcon: { width: 36, height: 36 },
  powerIconOff: { opacity: 0.6 },
  unlockTier: { flexDirection: "row", alignItems: "center", gap: 4 },
  unlockBadge: { width: 28, height: 28 },
  powerTrail: { color: "#D4D4D8", fontSize: 12, fontWeight: "600" },
  powerTrailOff: { color: "#71717A", fontSize: 12 },
  powerCount: { color: "#F4F4F5", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },

  historySheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },
  historyHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  historyHeaderText: { flex: 1, minWidth: 0 },
  historyTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyTitle: { color: systemColors.foreground, fontSize: 18, fontWeight: "600" },
  historySubtitle: { color: systemColors.mutedForeground, fontSize: 12, marginTop: 3 },
  historyList: { maxHeight: 440 },
  historyListContent: { gap: 8 },
  historyEmpty: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 32,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 14,
  },
  historyEmptyText: { color: "#D4D4D8", fontSize: 13, textAlign: "center" },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 14,
  },
  historySubject: { flex: 1, minWidth: 0 },
  historySubjectText: { color: systemColors.foreground, fontSize: 13 },
  historyDate: { color: systemColors.mutedForeground, fontSize: 10.5, marginTop: 3 },
  historyResult: { alignItems: "flex-end" },
  historyResultText: { color: "#E4E4E7", fontSize: 12, fontWeight: "500" },
  historyState: { color: systemColors.mutedForeground, fontSize: 10, marginTop: 2 },

  table: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    overflow: "hidden",
  },
  tableHead: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingVertical: 10 },
  // Headers wrap to two lines instead of clipping in long languages.
  th: { color: "#808089", fontSize: 11, lineHeight: 14 },
  tr: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
  },
  trMine: { backgroundColor: "rgba(255,255,255,0.1)" },
  td: { color: "#A1A1AA", fontSize: 13 },
  tdMine: { color: "#fff", fontWeight: "500" },
  colTier: { flex: 1.6 },
  colNum: { flex: 1, textAlign: "right" },
});
