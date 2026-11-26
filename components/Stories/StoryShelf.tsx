/** Live broadcasts and Stories share a horizontal shelf at the top of Home. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { KeepDark } from "../../libs/jsx/tone";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useSnapshot } from "valtio";

import { useStoriesEnabled } from "../../hooks/useStoriesEnabled";
import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { useUser, useAuthActions } from "../../context/AuthContext";
import { usePagerGestureRef } from "../../context/PagerGestureContext";
import { useAppTheme } from "../../context/ThemeContext";
import { MATURE_CONTENT_ENABLED } from "../../config/storefront";
import { useKidsModeLock } from "../../hooks/useKidsModeLock";
import { useLiveNowItems, LiveFace, type LiveNowItem } from "../Home/LiveNowBar";
import { getStoryShelf, type ShelfEntry } from "../../services/stories.service";
import { openStoryCreator, openStoryViewer, storiesState, type PendingMoment } from "../../store/stories.store";
import { avatarOf, nameOf, playable } from "./story-utils";
import { useBadgeAccount } from "../../hooks/useAccountBadge";
import { getAvatarUrl, getBadgeUrlFor } from "../../libs/misc";
import StoryCreateBar from "./StoryCreateBar";
import { storage } from "../../libs/storage";
import { formatCount } from "../../libs/format-count";
import { useLiveAudience } from "../../hooks/useLiveAudience";
import { setActivityBarHidden, useActivityShelfPreferences } from "../../libs/activity-shelf-preferences";
import { ActivityShelfMenu, type ActivityTarget } from "./ActivityShelfMenu";

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
  const { items: live, open: openLive, loading: liveLoading } = useLiveNowItems();
  const kidsMode = useKidsModeLock();
  const canSeeMature = MATURE_CONTENT_ENABLED && user?.showMatureContent === true && !kidsMode;
  const liveHosts = [...new Set(live.map(item => (item.wallet || "").toLowerCase()).filter(Boolean))].sort().slice(0, 100).join(",");
  const { storiesEnabled, storiesSettingLoading } = useStoriesEnabled();
  const shelfEnabled = storiesEnabled || !!liveHosts;
  const { data, isLoading, isPending, isError } = useStoryShelf(me, liveHosts, canSeeMature, shelfEnabled);
  // Still waiting on the setting or the first shelf (a cold start, or the saved
  // copy still being restored): the row cannot know its final shape yet.
  const waiting = storiesSettingLoading || (shelfEnabled && isPending && !data);
  // Lives arrive a beat after the shelf, and the shelf then checks their hosts
  // again. Until both are in, an empty row is not an answer yet.
  const vetting = liveLoading || (!!data && !isError && (data.askedHosts ?? "") !== liveHosts);
  return { user, me, live, openLive, canSeeMature, storiesEnabled, data, isLoading, waiting, vetting };
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
  const { hidden, dismissed } = useActivityShelfPreferences();
  return hidden ? <RestoreActivityBar /> : <VisibleStoryShelf dismissed={dismissed} />;
}

function RestoreActivityBar() {
  const { t } = useTranslation();
  const c = usePillColors();
  return (
    <TouchableOpacity accessibilityRole="button" onPress={() => setActivityBarHidden(false)}
      style={[styles.restore, { borderColor: c.line, backgroundColor: c.fill }]}>
      <Icon name="Eye" size={16} color={c.ink} />
      <Text style={[styles.name, { color: c.ink }]}>{t("stories.activity.showBar", { defaultValue: "Show activity bar" })}</Text>
    </TouchableOpacity>
  );
}

const liveKey = (item: LiveNowItem) => `${item.kind}:${item.id}`;

function VisibleStoryShelf({ dismissed }: { dismissed: string[] }) {
  const { t } = useTranslation();
  const { requireAuth } = useAuthActions();
  const { user, me, live, openLive, canSeeMature, storiesEnabled, data, isLoading, waiting, vetting } = useShelfState();
  const heldSeat = useRef<ShelfSeat>(readShelfSeat());
  const eligibleLive = live.filter(item => !dismissed.includes(liveKey(item)) && data?.liveHosts?.includes((item.wallet || "").toLowerCase()));
  const { pending } = useSnapshot(storiesState);
  const pagerRef = usePagerGestureRef();
  // Keep a swipe in the native scroll view even if the finger drifts below the shelf.
  const scrollGuard = useMemo(() => pagerRef
    ? Gesture.Native().shouldCancelWhenOutside(false).blocksExternalGesture(pagerRef)
    : null, [pagerRef]);
  const [menu, setMenu] = useState<{ target?: ActivityTarget } | null>();
  const closeMenu = useCallback(() => setMenu(null), []);
  const openBarMenu = () => setMenu({});
  const menuElement = menu !== undefined && <ActivityShelfMenu target={menu?.target} visible={!!menu} onClose={closeMenu} />;

  const shelf = useMemo(() => data?.shelf ?? [], [data]);
  const watchable = useMemo(
    () => shelf.map((e) => ({ ...e, items: playable(e.items).filter(item => !dismissed.includes(`story:${item.id}`) && (canSeeMature || !item.isMature)) })).filter((e) => e.items.length > 0),
    [shelf, canSeeMature, dismissed],
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
  const openStoryMenu = (entry: ShelfEntry) => setMenu({ target: {
    kind: "story", ids: entry.items.map(item => `story:${item.id}`),
    open: () => openEntry(entry), creator: entry.own ? undefined : entry.author.address,
  } });

  const hidden = (!storiesEnabled || (!me && others.length === 0 && !isLoading)) && eligibleLive.length === 0;
  // Signed in and nobody has a Moment up (yours included): the ask bar takes
  // the row's place instead of a lone "Your day" tile.
  const hasOwnMoment = !!own?.items.some(item => !dismissed.includes(`story:${item.id}`));
  const bare = storiesEnabled && !!me && !isLoading && !pending && !hasOwnMoment && others.length === 0 && eligibleLive.length === 0;
  const seat: ShelfSeat = hidden ? "none" : bare ? "ask" : "row";
  // Until the setting, the first shelf and the live check are in, keep the
  // shape already on screen (or Home's last one): row of loading tiles, ask
  // bar, or nothing, so the feed never moves.
  const nothingYet = eligibleLive.length === 0 && others.length === 0 && !hasOwnMoment;
  const holding = eligibleLive.length === 0 && (waiting || (vetting && nothingYet));
  if (!holding) heldSeat.current = seat;
  const lastSeat = heldSeat.current;
  useEffect(() => {
    if (!holding) saveShelfSeat(seat);
  }, [holding, seat]);
  if (holding ? lastSeat === "none" || (lastSeat === "ask" && !me) : hidden) return null;
  if (holding ? lastSeat === "ask" : bare) return <><StoryCreateBar onActivityOptions={openBarMenu} />{menuElement}</>;

  const processing = !!own?.items.some(item => item.status === "processing" && !dismissed.includes(`story:${item.id}`));
  const showMe = !!(storiesEnabled && me && (pending || processing || ownWatchable));
  const shownOthers = storiesEnabled ? others : [];
  const loading = holding || (storiesEnabled && isLoading);
  const liveOnly = !loading && !showMe && shownOthers.length === 0 && eligibleLive.length === 1;
  const shelfScroll = (
    <ScrollView
      horizontal
      nestedScrollEnabled
      directionalLockEnabled
      bounces={false}
      overScrollMode="never"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.wrap}
    >
      {(storiesEnabled || holding) && me ? <CreateTile onAdd={add} onActivityOptions={openBarMenu} /> : null}
      {showMe ? (
        <MeTile
          pending={pending as PendingMoment | null}
          avatar={user?.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl, 96) ?? null : avatarOf(own?.author ?? { address: me, username: null, displayName: null, avatarImageUrl: null }, 96)}
          name={t("stories.you", { defaultValue: "You" })}
          entry={ownWatchable}
          processing={processing}
          onOpen={() => ownWatchable && openEntry(ownWatchable)}
          onMenu={ownWatchable && !pending ? () => openStoryMenu(ownWatchable) : openBarMenu}
        />
      ) : null}
      {loading ? [0, 1, 2].map(index => <LoadingTile key={`loading-${index}`} />) : null}
      {shownOthers.map(entry => (
        <PersonTile key={entry.author.address} entry={entry} onOpen={() => openEntry(entry)} onMenu={() => openStoryMenu(entry)} />
      ))}
      {eligibleLive.map(item => (
        <LiveTile key={liveKey(item)} item={item} single={liveOnly} onOpen={() => openLive(item)}
          onMenu={() => setMenu({ target: { kind: item.kind, ids: [liveKey(item)], creator: item.wallet, open: () => openLive(item) } })} />
      ))}
    </ScrollView>
  );

  return (
    <>
      {scrollGuard ? <GestureDetector gesture={scrollGuard}>{shelfScroll}</GestureDetector> : shelfScroll}
      {menuElement}
    </>
  );
}

/** Pill colours. Written as hsla so the System Light tone pass leaves them alone. */
function usePillColors() {
  const { isLight, skin, accent } = useAppTheme();
  return useMemo(() => {
    const acc = skin && accent ? `rgba(${accent[0]},${accent[1]},${accent[2]},1)` : null;
    return isLight
      ? { ink: "hsla(240,8%,7%,1)", sub: "hsla(240,8%,4%,0.56)", line: "hsla(240,8%,4%,0.1)", fill: "transparent", ring: "hsla(240,8%,7%,1)", gap: "hsla(0,0%,100%,1)", wash: "hsla(240,5%,50%,0.2)" }
      : { ink: "hsla(0,0%,100%,1)", sub: "rgba(255,255,255,0.6)", line: skin ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.14)", fill: skin ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)", ring: acc ?? "hsla(0,0%,100%,1)", gap: skin ? "rgba(20,16,32,0.9)" : "hsla(240,6%,5%,1)", wash: "rgba(127,127,135,0.25)" };
  }, [isLight, skin, accent]);
}

const PILL_H = 52;
const FACE_SIZE = 36;
const FACE_RADIUS = 12;

const PORTRAIT_WIDTH = 80;
const PORTRAIT_HEIGHT = 96;
const MOMENT_RING = ["#ffba4d", "#f22b61", "#a715ee"] as const;
const CLOSE_FRIENDS_RING = ["#a3e635", "#22c55e", "#0d9f69"] as const;

function CreateTile({ onAdd, onActivityOptions }: { onAdd: () => void; onActivityOptions: () => void }) {
  const { t } = useTranslation();
  const c = usePillColors();
  return (
    <PortraitButton label={t("stories.addMoment", { defaultValue: "Add a moment" })} onPress={onAdd} onMenu={onActivityOptions}
      style={styles.createTile}>
      <View style={[styles.createKey, { backgroundColor: c.ink }]}>
        <Icon name="Plus" size={20} color={c.gap} />
      </View>
      <Text style={[styles.portraitName, styles.createLabel, { color: c.ink }]} numberOfLines={2}>
        {t("stories.yourDay", { defaultValue: "Your day" })}
      </Text>
    </PortraitButton>
  );
}

function PortraitButton({ label, onPress, onMenu, busy, hint, style, children }: {
  label: string;
  onPress: () => void;
  onMenu: () => void;
  busy?: boolean;
  hint?: string;
  style?: typeof styles.createTile;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[styles.portrait, style, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={busy ? { busy: true, disabled: true } : undefined}
      disabled={busy}
      onPress={onPress}
      onLongPress={onMenu}
      accessibilityActions={busy ? undefined : [{ name: "activityOptions", label: t("stories.activity.options", { defaultValue: "Activity options" }) }]}
      onAccessibilityAction={event => { if (!busy && event.nativeEvent.actionName === "activityOptions") onMenu(); }}
    >
      {children}
    </TouchableOpacity>
  );
}

function PortraitPhoto({ avatar, name, seen = false, closeFriends, retry }: {
  avatar: string | null;
  name: string;
  seen?: boolean;
  closeFriends?: boolean;
  retry?: boolean;
}) {
  const c = usePillColors();
  const opacity = useSharedValue(seen ? 0.48 : 1);
  useEffect(() => {
    opacity.value = withTiming(seen ? 0.48 : 1, { duration: 240, reduceMotion: ReduceMotion.System });
  }, [opacity, seen]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, fade]} pointerEvents="none">
      <LinearGradient colors={closeFriends ? CLOSE_FRIENDS_RING : MOMENT_RING} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
        style={styles.portraitRing}>
        <View style={[styles.photoFrame, { backgroundColor: c.gap }]}>
          {retry
            ? <Icon name="RotateCcw" size={20} color={c.ink} />
            : <Avatar uri={avatar} size={PORTRAIT_WIDTH - 8} radius={9} name={name} style={styles.photo} />}
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

function PortraitCaption({ children, status }: { children: React.ReactNode; status?: boolean }) {
  return (
    <KeepDark.Provider value>
      <LinearGradient colors={["transparent", "hsla(0,0%,0%,0.79)", "hsla(0,0%,0%,0.94)"]} locations={[0, 0.4, 1]} style={[styles.caption, status && styles.statusCaption]} pointerEvents="none">
        {children}
      </LinearGradient>
    </KeepDark.Provider>
  );
}

function LoadingTile() {
  const c = usePillColors();
  return <View style={[styles.portrait, { backgroundColor: c.wash, borderColor: c.line }]} accessible={false} />;
}

function Pill({ label, onPress, onMenu, single, children, extra }: {
  label: string;
  onPress: () => void;
  onMenu: () => void;
  /** The only thing up: the pill takes the row and shows its extras. */
  single?: boolean;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const c = usePillColors();
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      style={[styles.pill, { borderColor: c.line, backgroundColor: c.fill }, single && styles.pillSingle]}
      activeOpacity={0.85}
      onPress={onPress}
      onLongPress={onMenu}
      accessibilityActions={[{ name: "activityOptions", label: t("stories.activity.options", { defaultValue: "Activity options" }) }]}
      onAccessibilityAction={event => { if (event.nativeEvent.actionName === "activityOptions") onMenu(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
      {single && extra ? <View style={styles.extra} pointerEvents="none">{extra}</View> : null}
    </TouchableOpacity>
  );
}

function PillText({ name, line }: { name: React.ReactNode; line: string }) {
  const c = usePillColors();
  return (
    <View style={styles.text} pointerEvents="none">
      <View style={styles.nameRow}>
        {name}
      </View>
      {line ? <Text style={[styles.line, { color: c.sub }]} numberOfLines={1}>{line}</Text> : null}
    </View>
  );
}

/** A few faces of who is watching a live, and how many more. */
function LiveWatchers({ streamId }: { streamId: string }) {
  const c = usePillColors();
  const { data } = useLiveAudience(streamId);
  const here = (data?.here ?? []).slice(0, 4);
  if (!here.length) return null;
  const more = Math.max(0, (data?.watching ?? 0) - here.length);
  return (
    <View style={styles.stack}>
      {here.map((a, i) => (
        <View key={a.address} style={[styles.watcher, { borderColor: c.gap }, i > 0 && styles.stackOverlap]}>
          <Avatar uri={a.avatarImageUrl ? getAvatarUrl(a.avatarImageUrl, 48) ?? null : null} size={22} radius={7} name={a.displayName || a.username || a.address} />
        </View>
      ))}
      {more > 0 ? <Text style={[styles.more, { color: c.sub }]}>+{formatCount(more)}</Text> : null}
    </View>
  );
}

function MeTile({ pending, avatar, name, entry, processing, onOpen, onMenu }: {
  pending: PendingMoment | null;
  avatar: string | null;
  name: string;
  entry: ShelfEntry | null;
  processing: boolean;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const { t } = useTranslation();
  const failed = pending?.state === "failed";
  const busy = !failed && (!!pending || (processing && !entry));
  const posting = t("stories.posting", { defaultValue: "Posting…" });
  const retry = t("stories.tapRetry", { defaultValue: "Tap to retry" });
  return (
    <PortraitButton label={failed ? retry : busy ? posting : name} busy={busy} onMenu={onMenu}
      onPress={failed ? () => pending?.retry?.() : onOpen}>
      <PortraitPhoto avatar={avatar} name={name} retry={failed} />
      <PortraitCaption status={busy || failed}>
        <Text style={styles.portraitName} numberOfLines={busy || failed ? 2 : 1}>{failed ? retry : busy ? posting : name}</Text>
      </PortraitCaption>
      {pending && !failed ? (
        <View style={styles.progressTrack} pointerEvents="none">
          <View style={[styles.progressFill, { width: `${pending.state === "processing" ? 100 : Math.max(6, Math.round(pending.progress * 100))}%` }]} />
        </View>
      ) : null}
    </PortraitButton>
  );
}

function LiveTile({ item, single, onOpen, onMenu }: { item: LiveNowItem; single: boolean; onOpen: () => void; onMenu: () => void }) {
  const { t } = useTranslation();
  const liveLabel = t("stages.live");
  const line = item.kind === "stage"
    ? [item.count ? t("stories.spot.listening", { n: item.count, defaultValue: "{{n}} listening" }) : ""]
    : [
        item.count ? t("stories.spot.watching", { n: item.count, defaultValue: "{{n}} watching" }) : "",
        item.views != null ? t("stories.spot.views", { n: formatCount(item.views), defaultValue: "{{n}} views" }) : "",
      ];
  return (
    <Pill
      single={single}
      label={`${item.title}, ${liveLabel}`}
      onPress={onOpen}
      onMenu={onMenu}
      extra={item.kind === "stream" ? <LiveWatchers streamId={item.id} /> : null}
    >
      <View style={styles.liveFace} pointerEvents="none"><LiveFace item={item} size={FACE_SIZE} radius={FACE_RADIUS} liveOrbit /></View>
      <PillText
        name={<TileIdentity displayName={item.displayName} fallback={item.username || item.title} lookup={item.kind === "stage" ? item.wallet : undefined} badge={item.badge} />}
        line={line.filter(Boolean).join(" · ") || item.title}
      />
    </Pill>
  );
}

function TileIdentity({ displayName, fallback, lookup, badge, onPhoto }: {
  displayName?: string | null;
  fallback: string;
  lookup?: string;
  badge?: number;
  onPhoto?: boolean;
}) {
  const account = useBadgeAccount(lookup);
  const c = usePillColors();
  const artwork = badge ?? (account && !account.hideBadgeAndBalance ? getBadgeUrlFor(account) : undefined);
  return (
    <>
      <Text style={onPhoto ? styles.portraitName : [styles.name, { color: c.ink }]} numberOfLines={1}>
        {displayName?.trim() || account?.displayName?.trim() || fallback}
      </Text>
      {artwork != null && <Image source={artwork} style={styles.identityBadge} contentFit="contain" />}
    </>
  );
}

function PersonTile({ entry, onOpen, onMenu }: { entry: ShelfEntry; onOpen: () => void; onMenu: () => void }) {
  const { t } = useTranslation();
  const name = nameOf(entry.author);
  return (
    <PortraitButton label={name} hint={entry.seen ? t("stories.watchedCount", { n: formatCount(entry.items.length) }) : undefined}
      onPress={onOpen} onMenu={onMenu}>
      <PortraitPhoto avatar={avatarOf(entry.author, 192)} name={name} seen={entry.seen} closeFriends={entry.closeFriends} />
      <PortraitCaption>
        <TileIdentity displayName={entry.author.displayName} fallback={name} lookup={entry.author.address} onPhoto />
      </PortraitCaption>
    </PortraitButton>
  );
}

const styles = StyleSheet.create({
  restore: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, marginVertical: 6, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1 },
  wrap: { marginTop: 6, marginBottom: 8, flexGrow: 0 },
  row: { flexGrow: 1, gap: 8, paddingVertical: 2, alignItems: "center" },
  pill: {
    flexGrow: 1,
    // Audience updates must not change the width of a pill during a swipe.
    flexBasis: 150,
    minWidth: 0,
    height: PILL_H,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 6,
    paddingRight: 12,
    overflow: "hidden",
  },
  pillSingle: { flex: 1, minWidth: 0 },
  liveFace: { width: FACE_SIZE + 7, height: FACE_SIZE + 7, alignItems: "center", justifyContent: "center" },
  portrait: { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT, flexShrink: 0, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  createTile: { alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8 },
  createKey: { width: 32, height: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  createLabel: { textAlign: "center" },
  portraitRing: { flex: 1, padding: 2, borderRadius: 11 },
  photoFrame: { flex: 1, padding: 1, borderRadius: 9, justifyContent: "center", alignItems: "center", overflow: "hidden" },
  photo: { width: "100%", height: "100%" },
  caption: { position: "absolute", left: 3, right: 3, bottom: 3, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, flexDirection: "row", alignItems: "center", gap: 3, paddingTop: 15, paddingBottom: 5, paddingHorizontal: 8 },
  statusCaption: { paddingHorizontal: 6 },
  portraitName: { flexShrink: 1, color: "hsla(0,0%,100%,1)", fontSize: 13, lineHeight: 17, fontWeight: "700" },
  text: { flexShrink: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  name: { flexShrink: 1, fontSize: 13.5, fontWeight: "700" },
  line: { fontSize: 11.5, fontWeight: "500" },
  identityBadge: { width: 14, height: 14 },
  extra: { marginLeft: "auto", paddingLeft: 8 },
  stack: { flexDirection: "row", alignItems: "center" },
  stackOverlap: { marginLeft: -7 },
  watcher: { borderWidth: 2, borderRadius: 9, overflow: "hidden" },
  more: { marginLeft: 6, fontSize: 11, fontWeight: "700" },
  progressTrack: { position: "absolute", left: 9, right: 9, bottom: 5, height: 2, borderRadius: 2, overflow: "hidden", backgroundColor: "hsla(0,0%,100%,0.25)" },
  progressFill: { height: 2, backgroundColor: "hsla(0,0%,100%,1)" },
});

export default React.memo(StoryShelf);
