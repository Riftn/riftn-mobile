/** Live broadcasts and Stories share a horizontal shelf at the top of Home. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
import { avatarOf, coverOf, nameOf, playable } from "./story-utils";
import { useBadgeAccount } from "../../hooks/useAccountBadge";
import { getAvatarUrl, getBadgeUrlFor } from "../../libs/misc";
import { useMomentPreviewsBlurred } from "../../libs/momentPreviewBlur";
import StoryCreateBar, { StoryCreateTile } from "./StoryCreateBar";
import { storage } from "../../libs/storage";
import { formatCount } from "../../libs/format-count";
import { formatShortAgo } from "../../libs/date.util";

/** What Home's Moments seat held last time, read before the first frame. */
type ShelfSeat = "row" | "ask" | "none";
const SHELF_SEAT_KEY = "story-shelf-seat";
function readShelfSeat(): ShelfSeat {
  try {
    const value = storage.getString(SHELF_SEAT_KEY);
    return value === "ask" || value === "none" ? value : "row";
  } catch {
    return "row";
  }
}
function saveShelfSeat(seat: ShelfSeat) {
  try { storage.set(SHELF_SEAT_KEY, seat); } catch { /* the row is assumed next time */ }
}

const TILE_W = 86;
const TILE_H = 118;
/** Rounded-square faces, as on web: 24 px with the 1 px rim, 8 px corners. */
const FACE = 22;
const FACE_R = 7;
/** Face and corner chips sit this far in from the tile edge. */
const CHIP_INSET = 7;

type ShelfData = Awaited<ReturnType<typeof getStoryShelf>> & { askedHosts?: string };

/**
 * Moments on the shelf, refreshed every minute while Home is up.
 *
 * One cache entry per viewer, not one per live list: the live list arrives
 * after the feed (stages load on mount), and keying on it started a second,
 * empty request that hid the row and dropped it in late, pushing the first
 * post down. Live hosts only ask which faces may show as Live tiles, so a new
 * list refetches in place while the row stays up. The single entry is also
 * what the saved startup cache holds, so a launch paints the shelf with the
 * feed from the first frame.
 */
function useStoryShelf(me: string, liveHosts: string, canSeeMature: boolean, enabled: boolean) {
  const hostsRef = useRef(liveHosts);
  hostsRef.current = liveHosts;
  const query = useQuery<ShelfData>({
    queryKey: ["story-shelf", me, canSeeMature],
    queryFn: async () => {
      const askedHosts = hostsRef.current;
      return { ...(await getStoryShelf(!!me, askedHosts)), askedHosts };
    },
    enabled,
    // Signing in or a mature-content switch changes the key: keep the row up
    // while the new shelf loads, minus a "Your day" that was someone else's.
    placeholderData: (previous, previousQuery) =>
      !previous || previousQuery?.queryKey[1] === me ? previous : { ...previous, shelf: previous.shelf.filter((entry) => !entry.own) },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const { data, isFetching, isPlaceholderData, refetch } = query;
  useEffect(() => {
    if (enabled && data && !isFetching && !isPlaceholderData && (data.askedHosts ?? "") !== liveHosts) void refetch?.();
  }, [enabled, data, isFetching, isPlaceholderData, liveHosts, refetch]);
  return query;
}

/** Everything the shelf reads, shared by the row and its early start on Home. */
function useShelfState() {
  const user = useUser();
  const me = (user?.walletAddress || user?.address || "").toLowerCase();
  const { items: live, open: openLive } = useLiveNowItems();
  const kidsMode = useKidsModeLock();
  const canSeeMature = MATURE_CONTENT_ENABLED && user?.showMatureContent === true && !kidsMode;
  const liveHosts = [...new Set(live.map(item => (item.wallet || "").toLowerCase()).filter(Boolean))].sort().slice(0, 100).join(",");
  const { storiesEnabled, storiesSettingLoading } = useStoriesEnabled();
  const shelfEnabled = storiesEnabled || !!liveHosts;
  const { data, isLoading, isPending } = useStoryShelf(me, liveHosts, canSeeMature, shelfEnabled);
  // Still waiting on the setting or the first shelf (a cold start, or the saved
  // copy still being restored): the row cannot know its final shape yet.
  const waiting = storiesSettingLoading || (shelfEnabled && isPending && !data);
  return { user, me, live, openLive, canSeeMature, storiesEnabled, data, isLoading, waiting };
}

/**
 * The shelf sits in the feed's first row, which only exists once the feed has
 * its first page, so on its own it started loading after the feed had already
 * painted. Home mounts this at once, so Moments load alongside the first feed
 * page and are ready when the row is drawn.
 */
export function StoryShelfWarm() {
  useShelfState();
  return null;
}

function StoryShelf() {
  const { t } = useTranslation();
  const { requireAuth } = useAuthActions();
  const { user, me, live, openLive, canSeeMature, storiesEnabled, data, isLoading, waiting } = useShelfState();
  const [lastSeat] = useState(readShelfSeat);
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

  const hidden = (!storiesEnabled || (!me && others.length === 0 && !isLoading)) && eligibleLive.length === 0;
  // Signed in and nobody has a Moment up (yours included): the ask bar takes
  // the row's place instead of a lone "Your day" tile.
  const bare = storiesEnabled && !!me && !isLoading && !pending && !own?.items.length && others.length === 0 && eligibleLive.length === 0;
  const seat: ShelfSeat = hidden ? "none" : bare ? "ask" : "row";
  useEffect(() => {
    if (!waiting) saveShelfSeat(seat);
  }, [waiting, seat]);
  // Until the setting and the first shelf are in, draw the shape Home had last
  // time (row of loading tiles, ask bar, or nothing) so the feed never moves.
  const holding = waiting && eligibleLive.length === 0;
  if (holding ? lastSeat === "none" || (lastSeat === "ask" && !me) : hidden) return null;
  if (holding ? lastSeat === "ask" : bare) return <StoryCreateBar />;

  // With only 1 to 3 things up the row would end in empty space, so the first
  // live (else the first Moment, else your own) grows into it and says more.
  const showMe = !!(storiesEnabled && me && (pending || ownWatchable));
  const shownOthers = storiesEnabled ? others : [];
  const upCount = (showMe ? 1 : 0) + eligibleLive.length + shownOthers.length;
  const few = !holding && !isLoading && upCount >= 1 && upCount <= 3;
  const spotlight = !few ? null : eligibleLive[0] ? "live" : shownOthers[0] ? "person" : "me";

  const shelfScroll = (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, few && styles.rowFill]}
      style={styles.wrap}
    >
      {(storiesEnabled || holding) && me ? <StoryCreateTile width={TILE_W} height={TILE_H} /> : null}
      {showMe ? (
        <MeTile
          spotlight={spotlight === "me"}
          pending={pending as PendingMoment | null}
          avatar={user?.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl, 96) ?? null : avatarOf(own?.author ?? { address: me, username: null, displayName: null, avatarImageUrl: null }, 96)}
          name={t("stories.yourDay", { defaultValue: "Your day" })}
          entry={ownWatchable}
          processing={!!own?.items.some((i) => i.status === "processing")}
          onOpen={() => ownWatchable && openEntry(ownWatchable)}
          onAdd={add}
        />
      ) : null}
      {eligibleLive.map((item, index) => (
        <LiveTile key={`${item.kind}-${item.id}`} item={item} spotlight={spotlight === "live" && index === 0} onOpen={() => openLive(item)} />
      ))}
      {holding || (storiesEnabled && isLoading) ? [0, 1, 2, 3].map((index) => (
        <View key={`loading-${index}`} style={[styles.tile, styles.loadingTile, isLight && styles.loadingTileLight]}>
          <View style={[styles.loadingFace, isLight && styles.loadingBarLight]} />
          <View style={[styles.loadingBar, isLight && styles.loadingBarLight]} />
        </View>
      )) : null}
      {shownOthers.map((entry, index) => (
        <PersonTile key={entry.author.address} entry={entry} spotlight={spotlight === "person" && index === 0} onOpen={() => openEntry(entry)} />
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

/** True inside a spotlight tile once it is wide enough for the bigger name and a line under it. */
const SpotWide = createContext(false);
const SPOT_MIN = 150;

function ShelfTile({ cover, avatar, label, onPress, badge, action, seen, blur, closeFriends, spotlight, spot, children }: {
  cover?: string | null;
  /** 1 to 3 things up: this tile grows into the spare room. */
  spotlight?: boolean;
  /** The line under the name once the spotlight is wide. */
  spot?: string | null;
  seen?: boolean;
  /** A Close Friends Moment: green rim until watched. */
  closeFriends?: boolean;
  /** Settings > Blur Moment previews: the picture stays blurred until opened. */
  blur?: boolean;
  avatar: React.ReactNode | null;
  label: string;
  onPress: () => void;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { isLight } = useAppTheme();
  const [width, setWidth] = useState(0);
  const wide = !!spotlight && width >= SPOT_MIN;
  return (
    <SpotWide.Provider value={wide}>
    <View
      className="dark-surface"
      style={[styles.tile, spotlight && styles.tileSpot, seen && styles.tileSeen]}
      onLayout={spotlight ? (e) => setWidth(e.nativeEvent.layout.width) : undefined}
    >
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {cover ? (
          <Image source={{ uri: cover }} recyclingKey={cover} style={StyleSheet.absoluteFill}
            contentFit="cover" cachePolicy="memory-disk" blurRadius={blur ? 40 : undefined} />
        ) : null}
        <LinearGradient
          colors={TILE_SHADE}
          locations={TILE_SHADE_AT}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View pointerEvents="none" style={[styles.frame, isLight && styles.lightFrame, closeFriends && !seen && styles.closeFriendsFrame]} />
        {avatar ? <View pointerEvents="none" style={styles.avatar}>{avatar}</View> : null}
        {badge}
        {children}
        {wide && spot ? <Text style={styles.spot} numberOfLines={1} pointerEvents="none">{spot}</Text> : null}
        {/* Watched moments fade to grey so new ones stand out. */}
        {seen ? <View pointerEvents="none" style={styles.seenWash} /> : null}
      </TouchableOpacity>
      {action}
    </View>
    </SpotWide.Provider>
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
  spotlight,
}: {
  spotlight?: boolean;
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
      spotlight={spotlight}
      cover={pending?.preview ?? (entry && coverOf(entry))}
      avatar={failed ? null : <Avatar uri={avatar} size={FACE} radius={FACE_R} name={name} />}
      label={failed ? caption : name}
      onPress={failed ? () => pending?.retry?.() : entry ? onOpen : onAdd}
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

/** Live: a glass chip with sound bars moving (no red block), as on web. */
function LiveBars({ label }: { label: string }) {
  const bars = useRef([0.45, 0.8, 0.6].map((v) => new Animated.Value(v))).current;
  useEffect(() => {
    let stopped = false;
    const loops = bars.map((bar, i) => Animated.loop(Animated.sequence([
      Animated.timing(bar, { toValue: 1, duration: 420 + i * 90, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(bar, { toValue: 0.4, duration: 420 + i * 90, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])));
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => { if (!reduce && !stopped) loops.forEach((l) => l.start()); }).catch(() => {});
    return () => { stopped = true; loops.forEach((l) => l.stop()); };
  }, [bars]);
  return (
    <View pointerEvents="none" style={[styles.cornerBadge, styles.liveGlass]} accessible accessibilityLabel={label}>
      {bars.map((bar, i) => (
        <Animated.View key={i} style={[styles.liveBar, { transform: [{ scaleY: bar }] }]} />
      ))}
    </View>
  );
}

function LiveTile({ item, spotlight, onOpen }: { item: LiveNowItem; spotlight?: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const liveLabel = t("stages.live");
  const audience = item.count
    ? item.kind === "stage"
      ? t("stories.spot.listening", { n: item.count, defaultValue: "{{n}} listening" })
      : t("stories.spot.watching", { n: item.count, defaultValue: "{{n}} watching" })
    : "";
  return (
    <ShelfTile
      spotlight={spotlight}
      spot={[item.title, audience].filter(Boolean).join(" · ")}
      cover={item.cover}
      avatar={<LiveFace item={item} size={FACE} radius={FACE_R} live={false} />}
      label={`${item.title}, ${liveLabel}`}
      onPress={onOpen}
      badge={
        <LiveBars label={liveLabel} />
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
  const wide = useContext(SpotWide);
  const artwork = badge ?? (account && !account.hideBadgeAndBalance ? getBadgeUrlFor(account) : undefined);
  return (
    <View style={wide ? [styles.label, styles.labelWide] : styles.label} pointerEvents="none">
      <Text style={wide ? [styles.name, styles.nameWide] : styles.name} numberOfLines={1}>
        {displayName?.trim() || account?.displayName?.trim() || fallback}
      </Text>
      {artwork != null && <Image source={artwork} style={styles.identityBadge} contentFit="contain" />}
    </View>
  );
}

/** Dark shade over each tile photo: top for the face, bottom for the name. */
const TILE_SHADE = ["rgba(0,0,0,0.44)", "transparent", "transparent", "rgba(0,0,0,0.83)"] as const;
const TILE_SHADE_AT = [0, 0.36, 0.5, 1] as const;

function PersonTile({ entry, spotlight, onOpen }: { entry: ShelfEntry; spotlight?: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const name = nameOf(entry.author);
  const blurred = useMomentPreviewsBlurred();
  const moments = entry.items.length === 1
    ? t("stories.spot.oneMoment", { defaultValue: "1 Moment" })
    : t("stories.spot.moments", { n: formatCount(entry.items.length), defaultValue: "{{n}} Moments" });
  return (
    <ShelfTile
      spotlight={spotlight}
      spot={[entry.latestAt ? formatShortAgo(entry.latestAt) : "", moments].filter(Boolean).join(" · ")}
      cover={coverOf(entry)}
      seen={entry.seen}
      closeFriends={!!entry.closeFriends && !entry.own}
      blur={blurred}
      avatar={<Avatar uri={avatarOf(entry.author, 48)} size={FACE} radius={FACE_R} name={name} />}
      label={name}
      onPress={onOpen}
    >
      <TileIdentity displayName={entry.author.displayName} fallback={name} lookup={entry.author.address} />
    </ShelfTile>
  );
}

const styles = StyleSheet.create({
  tileSeen: { opacity: 0.6 },
  seenWash: { ...StyleSheet.absoluteFillObject, backgroundColor: "hsla(0, 0%, 45%, 0.45)" },
  wrap: { marginTop: 6, marginBottom: 8, flexGrow: 0 },
  row: { gap: 8, paddingVertical: 2 },
  rowFill: { flexGrow: 1 },
  tileSpot: { flexGrow: 1, width: undefined, minWidth: TILE_W },
  labelWide: { left: 12, right: 12, bottom: 29 },
  nameWide: { fontSize: 16, letterSpacing: -0.16 },
  spot: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 11,
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
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
  closeFriendsFrame: { borderWidth: 2, borderColor: "#22c55e" },
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
  glassChip: { borderWidth: 0, paddingHorizontal: 6, backgroundColor: "rgba(255,255,255,0.12)" },
  // Over the frosted photo the gradient alone is the fill, as on web.
  glassChipOverPhoto: { backgroundColor: "transparent" },
  glassRim: { ...StyleSheet.absoluteFillObject, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.55)" },
  glassRimSeen: { borderColor: "rgba(255,255,255,0.3)" },
  glassBackdrop: { position: "absolute", top: -CHIP_INSET, width: TILE_W, height: TILE_H },
  glassSheen: { position: "absolute", top: 1, left: 6, right: 6, height: 1, backgroundColor: "rgba(255,255,255,0.45)" },
  glassText: { textShadowColor: "rgba(0,0,0,0.45)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  liveBadge: { backgroundColor: "#BF303B", borderColor: "#D56E78" },
  liveGlass: { flexDirection: "row", gap: 2, paddingHorizontal: 7, backgroundColor: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.5)" },
  liveBar: { width: 2.5, height: 12, borderRadius: 2, backgroundColor: "#fff" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  liveText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.35 },
  plusHit: { position: "absolute", top: 7, right: 7 },
  plus: {
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
