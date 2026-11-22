/** Live broadcasts and Stories share a horizontal shelf at the top of Home. */
import React, { useCallback, useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BlurView } from "expo-blur";
import { GestureDetector } from "react-native-gesture-handler";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useSnapshot } from "valtio";

import { useStoriesEnabled } from "../../hooks/useStoriesEnabled";
import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { useUser, useAuthActions } from "../../context/AuthContext";
import { useHorizontalScrollGuard, useHorizontalSectionGuard } from "../../context/PagerGestureContext";
import { useAppTheme } from "../../context/ThemeContext";
import { MATURE_CONTENT_ENABLED } from "../../config/storefront";
import { useKidsModeLock } from "../../hooks/useKidsModeLock";
import { useLiveNowItems, LiveFace, type LiveNowItem } from "../Home/LiveNowBar";
import { getStoryShelf, type ShelfEntry } from "../../services/stories.service";
import { openStoryCreator, openStoryViewer, storiesState, type PendingMoment } from "../../store/stories.store";
import { ageLabel, avatarOf, coverOf, nameOf, playable } from "./story-utils";
import { useBadgeAccount } from "../../hooks/useAccountBadge";
import { getAvatarUrl, getBadgeUrlFor } from "../../libs/misc";

const TILE_W = 86;
const TILE_H = 118;
/** Rounded-square faces, as on web: 24 px with the 1 px rim, 8 px corners. */
const FACE = 22;
const FACE_R = 7;

/** Moments on the shelf, refreshed every minute while Home is up. */
function useStoryShelf(me: string, liveHosts: string, canSeeMature: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ["story-shelf", me, canSeeMature, liveHosts],
    queryFn: () => getStoryShelf(!!me, liveHosts),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

function StoryShelf() {
  const { t } = useTranslation();
  const user = useUser();
  const { requireAuth } = useAuthActions();
  const me = (user?.walletAddress || user?.address || "").toLowerCase();
  const { items: live, open: openLive } = useLiveNowItems();
  const kidsMode = useKidsModeLock();
  const canSeeMature = MATURE_CONTENT_ENABLED && user?.showMatureContent === true && !kidsMode;
  const liveHosts = [...new Set(live.map(item => (item.wallet || "").toLowerCase()).filter(Boolean))].sort().slice(0, 100).join(",");
  const { storiesEnabled } = useStoriesEnabled();
  const { data, isLoading } = useStoryShelf(me, liveHosts, canSeeMature, storiesEnabled || !!liveHosts);
  const eligibleLive = live.filter(item => data?.liveHosts?.includes((item.wallet || "").toLowerCase()));
  const { pending } = useSnapshot(storiesState);
  const { isLight } = useAppTheme();
  const scrollGuard = useHorizontalScrollGuard();
  const shelfGuard = useHorizontalSectionGuard(scrollGuard);

  const shelf = useMemo(() => data?.shelf ?? [], [data]);
  const watchable = useMemo(
    () => shelf.map((e) => ({ ...e, items: playable(e.items).filter(item => canSeeMature || !item.isMature) })).filter((e) => e.items.length > 0),
    [shelf, canSeeMature],
  );
  const own = shelf.find((e) => e.own) ?? null;
  const ownWatchable = watchable.find((e) => e.own) ?? null;
  const others = watchable.filter((e) => !e.own);

  const openEntry = useCallback(
    (entry: ShelfEntry) => {
      const index = watchable.findIndex((e) => e.author.address === entry.author.address);
      if (index >= 0) openStoryViewer(watchable, index);
    },
    [watchable],
  );
  const add = useCallback(() => requireAuth(() => openStoryCreator()), [requireAuth]);

  if ((!storiesEnabled || (!me && others.length === 0)) && eligibleLive.length === 0) return null;

  const shelfScroll = (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.wrap}
    >
      {storiesEnabled && me ? (
        <MeTile
          pending={pending as PendingMoment | null}
          avatar={user?.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl, 96) ?? null : avatarOf(own?.author ?? { address: me, username: null, displayName: null, avatarImageUrl: null }, 96)}
          name={t("stories.yourDay", { defaultValue: "Your day" })}
          entry={ownWatchable}
          processing={!!own?.items.some((i) => i.status === "processing")}
          onOpen={() => ownWatchable && openEntry(ownWatchable)}
          onAdd={add}
        />
      ) : null}
      {eligibleLive.map((item) => (
        <LiveTile key={`${item.kind}-${item.id}`} item={item} onOpen={() => openLive(item)} />
      ))}
      {storiesEnabled && me && isLoading ? [0, 1, 2, 3].map((index) => (
        <View key={`loading-${index}`} style={[styles.tile, styles.loadingTile, isLight && styles.loadingTileLight]}>
          <View style={[styles.loadingFace, isLight && styles.loadingBarLight]} />
          <View style={[styles.loadingBar, isLight && styles.loadingBarLight]} />
        </View>
      )) : null}
      {storiesEnabled && others.map((entry) => (
        <PersonTile key={entry.author.address} entry={entry} onOpen={() => openEntry(entry)} />
      ))}
    </ScrollView>
  );

  if (!scrollGuard || !shelfGuard) return shelfScroll;
  return (
    <GestureDetector gesture={shelfGuard}>
      <View collapsable={false}>
        <GestureDetector gesture={scrollGuard}>{shelfScroll}</GestureDetector>
      </View>
    </GestureDetector>
  );
}

function ShelfTile({ cover, avatar, label, onPress, badge, action, children }: {
  cover?: string | null;
  avatar: React.ReactNode | null;
  label: string;
  onPress: () => void;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { isLight } = useAppTheme();
  return (
    <View className="dark-surface" style={styles.tile}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {cover ? (
          <Image source={{ uri: cover }} recyclingKey={cover} style={StyleSheet.absoluteFill}
            contentFit="cover" cachePolicy="memory-disk" />
        ) : null}
        <LinearGradient
          colors={["rgba(0,0,0,0.44)", "transparent", "transparent", "rgba(0,0,0,0.83)"]}
          locations={[0, 0.36, 0.5, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View pointerEvents="none" style={[styles.frame, isLight && styles.lightFrame]} />
        {avatar ? <View pointerEvents="none" style={styles.avatar}>{avatar}</View> : null}
        {badge}
        {children}
      </TouchableOpacity>
      {action}
    </View>
  );
}

function MeTile({
  pending,
  avatar,
  name,
  entry,
  processing,
  onOpen,
  onAdd,
}: {
  pending: PendingMoment | null;
  avatar: string | null;
  name: string;
  entry: ShelfEntry | null;
  processing: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const failed = pending?.state === "failed";
  const caption = failed
    ? t("stories.tapRetry", { defaultValue: "Tap to retry" })
    : pending || processing
      ? t("stories.posting", { defaultValue: "Posting…" })
      : name;
  return (
    <ShelfTile
      cover={pending?.preview ?? (entry && coverOf(entry))}
      avatar={failed ? null : <Avatar uri={avatar} size={FACE} radius={FACE_R} name={name} />}
      label={failed ? caption : name}
      onPress={failed ? () => pending?.retry?.() : entry ? onOpen : onAdd}
      action={failed ? null : (
        <TouchableOpacity onPress={onAdd} hitSlop={8} style={styles.plus}
          accessibilityRole="button" accessibilityLabel={t("stories.addMoment", { defaultValue: "Add a moment" })}>
          <Icon name="Plus" size={15} color="#111" strokeWidth={2.6} />
        </TouchableOpacity>
      )}
    >
      {pending && !failed ? (
        <View style={styles.progressTrack} pointerEvents="none">
          <View style={[styles.progressFill, { width: `${pending.state === "processing" ? 100 : Math.max(6, Math.round(pending.progress * 100))}%` }]} />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.retry}><Icon name="RotateCcw" size={18} color="#fff" /></View>
        </View>
      ) : null}
      <View style={styles.label} pointerEvents="none">
        <Text style={styles.name} numberOfLines={1}>{caption}</Text>
      </View>
    </ShelfTile>
  );
}

function LiveTile({ item, onOpen }: { item: LiveNowItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const liveLabel = t("stages.live");
  return (
    <ShelfTile
      cover={item.cover}
      avatar={<LiveFace item={item} size={FACE} radius={FACE_R} live={false} />}
      label={`${item.title}, ${liveLabel}`}
      onPress={onOpen}
      badge={
        <View pointerEvents="none" style={[styles.cornerBadge, styles.liveBadge]}>
          <Text style={[styles.badgeText, styles.liveText]} numberOfLines={1}>{liveLabel}</Text>
        </View>
      }
    >
      <TileIdentity
        displayName={item.displayName}
        fallback={item.username || item.title}
        lookup={item.kind === "stage" ? item.wallet : undefined}
        badge={item.badge}
      />
    </ShelfTile>
  );
}

function TileIdentity({ displayName, fallback, lookup, badge }: {
  displayName?: string | null;
  fallback: string;
  lookup?: string;
  badge?: number;
}) {
  const account = useBadgeAccount(lookup);
  const artwork = badge ?? (account && !account.hideBadgeAndBalance ? getBadgeUrlFor(account) : undefined);
  return (
    <View style={styles.label} pointerEvents="none">
      <Text style={styles.name} numberOfLines={1}>
        {displayName?.trim() || account?.displayName?.trim() || fallback}
      </Text>
      {artwork != null && <Image source={artwork} style={styles.identityBadge} contentFit="contain" />}
    </View>
  );
}

/**
 * The time chip, as on web: liquid glass the size of the face opposite it
 * (24 px, 8 px corners). The photo shows through (blurred on iPhone), with a
 * bright rim and a sheen on top.
 */
function GlassTime({ label, seen }: { label: string; seen?: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.cornerBadge, styles.glassChip, seen && styles.glassChipSeen]}>
      {Platform.OS === "ios" ? <BlurView intensity={22} tint="light" style={StyleSheet.absoluteFill} /> : null}
      <LinearGradient colors={["rgba(255,255,255,0.32)", "rgba(255,255,255,0.08)"]} style={StyleSheet.absoluteFill} />
      <View style={styles.glassSheen} />
      <Text style={[styles.badgeText, styles.glassText]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function PersonTile({ entry, onOpen }: { entry: ShelfEntry; onOpen: () => void }) {
  const name = nameOf(entry.author);
  const age = ageLabel(entry.items[entry.items.length - 1]?.createdAt);
  return (
    <ShelfTile
      cover={coverOf(entry)}
      avatar={<Avatar uri={avatarOf(entry.author, 48)} size={FACE} radius={FACE_R} name={name} />}
      label={name}
      onPress={onOpen}
      badge={age ? <GlassTime label={age} seen={entry.seen} /> : null}
    >
      <TileIdentity displayName={entry.author.displayName} fallback={name} lookup={entry.author.address} />
    </ShelfTile>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, marginBottom: 8, flexGrow: 0 },
  row: { gap: 8, paddingVertical: 2 },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#292b32",
  },
  frame: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  lightFrame: { borderColor: "rgba(113,113,122,0.24)" },
  avatar: {
    position: "absolute",
    top: 7,
    left: 7,
    borderColor: "rgba(255,255,255,0.7)",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#3c404a",
  },
  label: {
    position: "absolute",
    left: 7,
    right: 6,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  identityBadge: { width: 12, height: 12 },
  name: {
    flexShrink: 1,
    color: "#fff",
    fontSize: 11.5,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  /** Corner chips match the face opposite: 24 px, 8 px corners, 7 px in. */
  cornerBadge: {
    position: "absolute",
    top: 7,
    right: 7,
    height: 24,
    minWidth: 24,
    maxWidth: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
  },
  glassChip: {
    borderColor: "rgba(255,255,255,0.55)",
    backgroundColor: Platform.OS === "ios" ? "transparent" : "rgba(255,255,255,0.1)",
  },
  glassChipSeen: { borderColor: "rgba(255,255,255,0.3)" },
  glassSheen: { position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.45)" },
  glassText: { textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  liveBadge: { backgroundColor: "#BF303B", borderColor: "#D56E78" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  liveText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.35 },
  plus: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: "#f2f2f2",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingTile: { backgroundColor: "rgba(255,255,255,0.04)" },
  loadingTileLight: { backgroundColor: "rgba(0,0,0,0.04)" },
  loadingFace: { position: "absolute", top: 7, left: 7, width: 24, height: 24, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.1)" },
  loadingBar: { position: "absolute", bottom: 8, left: 8, width: 40, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.1)" },
  loadingBarLight: { backgroundColor: "rgba(0,0,0,0.1)" },
  progressTrack: { position: "absolute", left: 7, right: 6, bottom: 28, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden" },
  progressFill: { height: 3, backgroundColor: "#fff" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  retry: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
});

export default React.memo(StoryShelf);
