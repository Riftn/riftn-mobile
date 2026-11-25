/** Live broadcasts and Stories share a horizontal shelf at the top of Home. */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { Image } from "expo-image";
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
import { avatarOf, nameOf, playable } from "./story-utils";
import { useBadgeAccount } from "../../hooks/useAccountBadge";
import { getAvatarUrl, getBadgeUrlFor } from "../../libs/misc";
import { useMomentPreviewsBlurred } from "../../libs/momentPreviewBlur";
import StoryCreateBar, { StoryCreateTile } from "./StoryCreateBar";
import { storage } from "../../libs/storage";
import { formatCount } from "../../libs/format-count";
import { formatShortAgo } from "../../libs/date.util";
import { useLiveAudience } from "../../hooks/useLiveAudience";

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
  const { t } = useTranslation();
  const { requireAuth } = useAuthActions();
  const { user, me, live, openLive, canSeeMature, storiesEnabled, data, isLoading, waiting, vetting } = useShelfState();
  const heldSeat = useRef<ShelfSeat>(readShelfSeat());
  const eligibleLive = live.filter(item => data?.liveHosts?.includes((item.wallet || "").toLowerCase()));
  const { pending } = useSnapshot(storiesState);
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
  // Until the setting, the first shelf and the live check are in, keep the
  // shape already on screen (or Home's last one): row of loading tiles, ask
  // bar, or nothing, so the feed never moves.
  const nothingYet = eligibleLive.length === 0 && others.length === 0 && !own?.items.length;
  const holding = eligibleLive.length === 0 && (waiting || (vetting && nothingYet));
  if (!holding) heldSeat.current = seat;
  const lastSeat = heldSeat.current;
  useEffect(() => {
    if (!holding) saveShelfSeat(seat);
  }, [holding, seat]);
  if (holding ? lastSeat === "none" || (lastSeat === "ask" && !me) : hidden) return null;
  if (holding ? lastSeat === "ask" : bare) return <StoryCreateBar />;

  const showMe = !!(storiesEnabled && me && (pending || ownWatchable));
  const shownOthers = storiesEnabled ? others : [];
  // How many pills are up. With exactly 1 the pill takes the whole row and
  // shows a little more (who is watching, or the Moments themselves).
  const upCount = holding || isLoading ? 0 : (showMe ? 1 : 0) + eligibleLive.length + shownOthers.length;
  const single = upCount === 1;

  const shelfScroll = (
    <ScrollView
      horizontal
      nestedScrollEnabled
      scrollEnabled={!single}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.wrap}
    >
      {(storiesEnabled || holding) && me ? <StoryCreateTile width={PILL_H} height={PILL_H} /> : null}
      {showMe ? (
        <MeTile
          single={single}
          pending={pending as PendingMoment | null}
          avatar={user?.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl, 96) ?? null : avatarOf(own?.author ?? { address: me, username: null, displayName: null, avatarImageUrl: null }, 96)}
          name={t("stories.you", { defaultValue: "You" })}
          entry={ownWatchable}
          processing={!!own?.items.some((i) => i.status === "processing")}
          onOpen={() => ownWatchable && openEntry(ownWatchable)}
          onAdd={add}
        />
      ) : null}
      {eligibleLive.map((item) => (
        <LiveTile key={`${item.kind}-${item.id}`} item={item} single={single} onOpen={() => openLive(item)} />
      ))}
      {holding || (storiesEnabled && isLoading) ? [0, 1, 2].map((index) => <LoadingPill key={`loading-${index}`} />) : null}
      {shownOthers.map((entry) => (
        <PersonTile key={entry.author.address} entry={entry} single={single} onOpen={() => openEntry(entry)} />
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

function Pill({ label, onPress, single, children, extra }: {
  label: string;
  onPress: () => void;
  /** The only thing up: the pill takes the row and shows its extras. */
  single?: boolean;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const c = usePillColors();
  return (
    <TouchableOpacity
      style={[styles.pill, { borderColor: c.line, backgroundColor: c.fill }, single && styles.pillSingle]}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
      {single && extra ? <View style={styles.extra} pointerEvents="none">{extra}</View> : null}
    </TouchableOpacity>
  );
}

/** The face with its ring: none once watched, green for Close Friends. */
function PillFace({ children, seen, closeFriends, live }: { children: React.ReactNode; seen?: boolean; closeFriends?: boolean; live?: boolean }) {
  const c = usePillColors();
  const ring = seen || live ? "transparent" : closeFriends ? "#22c55e" : c.ring;
  return (
    <View style={[styles.ring, { borderColor: ring }, seen && styles.faceSeen]} pointerEvents="none">
      {children}
    </View>
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

function LoadingPill() {
  const c = usePillColors();
  return (
    <View style={[styles.pill, styles.loadingPill, { borderColor: c.line }]}>
      <View style={[styles.loadingFace, { backgroundColor: c.wash }]} />
      <View style={styles.loadingBars}>
        <View style={[styles.loadingBar, { backgroundColor: c.wash }]} />
        <View style={[styles.loadingBar, styles.loadingBarShort, { backgroundColor: c.wash }]} />
      </View>
    </View>
  );
}

function momentsLine(t: (key: string, options?: Record<string, unknown>) => string, count: number) {
  return count === 1
    ? t("stories.spot.oneMoment", { defaultValue: "1 Moment" })
    : t("stories.spot.moments", { n: formatCount(count), defaultValue: "{{n}} Moments" });
}

/** Small covers of someone's Moments, when the pill has the room. */
function MomentCovers({ entry }: { entry: ShelfEntry | null }) {
  const c = usePillColors();
  const blurred = useMomentPreviewsBlurred();
  if (!entry || blurred) return null;
  const covers = entry.items
    .map((item) => item.posterUrl || (item.type === "photo" ? item.mediaUrl : null))
    .filter((url): url is string => !!url)
    .slice(0, 3);
  if (!covers.length) return null;
  return (
    <View style={styles.stack}>
      {covers.map((url, i) => (
        <Image key={url} source={{ uri: url }} recyclingKey={url} contentFit="cover" cachePolicy="memory-disk"
          style={[styles.cover, { borderColor: c.gap }, i > 0 && styles.stackOverlap]} />
      ))}
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

function MeTile({
  pending,
  avatar,
  name,
  entry,
  processing,
  single,
  onOpen,
  onAdd,
}: {
  single: boolean;
  pending: PendingMoment | null;
  avatar: string | null;
  name: string;
  entry: ShelfEntry | null;
  processing: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const c = usePillColors();
  const failed = pending?.state === "failed";
  const line = failed
    ? t("stories.tapRetry", { defaultValue: "Tap to retry" })
    : pending || processing
      ? t("stories.posting", { defaultValue: "Posting…" })
      : momentsLine(t, entry?.items.length ?? 0);
  return (
    <Pill
      single={single}
      label={failed ? line : name}
      onPress={failed ? () => pending?.retry?.() : entry ? onOpen : onAdd}
      extra={pending ? null : <MomentCovers entry={entry} />}
    >
      <PillFace>
        {failed
          ? <View style={[styles.retry, { backgroundColor: c.wash }]}><Icon name="RotateCcw" size={16} color={c.ink} /></View>
          : <Avatar uri={avatar} size={FACE_SIZE} radius={FACE_RADIUS} name={name} />}
      </PillFace>
      <PillText name={<Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>{name}</Text>} line={line} />
      {pending && !failed ? (
        <View style={[styles.progressTrack, { backgroundColor: c.wash }]} pointerEvents="none">
          <View style={[styles.progressFill, { backgroundColor: c.ink, width: `${pending.state === "processing" ? 100 : Math.max(6, Math.round(pending.progress * 100))}%` }]} />
        </View>
      ) : null}
    </Pill>
  );
}

function LiveTile({ item, single, onOpen }: { item: LiveNowItem; single: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const liveLabel = t("stages.live");
  const line = item.kind === "stage"
    ? [item.count ? t("stories.spot.listening", { n: item.count, defaultValue: "{{n}} listening" }) : ""]
    : [
        item.count ? t("stories.spot.watching", { n: item.count, defaultValue: "{{n}} watching" }) : "",
        item.views ? t("stories.spot.views", { n: formatCount(item.views), defaultValue: "{{n}} views" }) : "",
      ];
  return (
    <Pill
      single={single}
      label={`${item.title}, ${liveLabel}`}
      onPress={onOpen}
      extra={item.kind === "stream" ? <LiveWatchers streamId={item.id} /> : null}
    >
      <PillFace live><LiveFace item={item} size={FACE_SIZE} radius={FACE_RADIUS} liveOrbit /></PillFace>
      <PillText
        name={<TileIdentity displayName={item.displayName} fallback={item.username || item.title} lookup={item.kind === "stage" ? item.wallet : undefined} badge={item.badge} />}
        line={line.filter(Boolean).join(" · ") || item.title}
      />
    </Pill>
  );
}

function TileIdentity({ displayName, fallback, lookup, badge }: {
  displayName?: string | null;
  fallback: string;
  lookup?: string;
  badge?: number;
}) {
  const account = useBadgeAccount(lookup);
  const c = usePillColors();
  const artwork = badge ?? (account && !account.hideBadgeAndBalance ? getBadgeUrlFor(account) : undefined);
  return (
    <>
      <Text style={[styles.name, { color: c.ink }]} numberOfLines={1}>
        {displayName?.trim() || account?.displayName?.trim() || fallback}
      </Text>
      {artwork != null && <Image source={artwork} style={styles.identityBadge} contentFit="contain" />}
    </>
  );
}

function PersonTile({ entry, single, onOpen }: { entry: ShelfEntry; single: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const name = nameOf(entry.author);
  return (
    <Pill single={single} label={name} onPress={onOpen} extra={<MomentCovers entry={entry} />}>
      <PillFace seen={entry.seen} closeFriends={!!entry.closeFriends && !entry.own}>
        <Avatar uri={avatarOf(entry.author, 96)} size={FACE_SIZE} radius={FACE_RADIUS} name={name} />
      </PillFace>
      <PillText
        name={<TileIdentity displayName={entry.author.displayName} fallback={name} lookup={entry.author.address} />}
        line={[entry.latestAt ? formatShortAgo(entry.latestAt) : "", momentsLine(t, entry.items.length)].filter(Boolean).join(" · ")}
      />
    </Pill>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, marginBottom: 8, flexGrow: 0 },
  row: { flexGrow: 1, gap: 8, paddingVertical: 2, alignItems: "center" },
  pill: {
    flexGrow: 1,
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
  ring: { width: FACE_SIZE + 7, height: FACE_SIZE + 7, borderRadius: FACE_RADIUS + 3.5, borderWidth: 1.5, padding: 2, alignItems: "center", justifyContent: "center" },
  faceSeen: { opacity: 0.8 },
  text: { flexShrink: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  name: { flexShrink: 1, fontSize: 13.5, fontWeight: "700" },
  line: { fontSize: 11.5, fontWeight: "500" },
  identityBadge: { width: 14, height: 14 },
  extra: { marginLeft: "auto", paddingLeft: 8 },
  stack: { flexDirection: "row", alignItems: "center" },
  stackOverlap: { marginLeft: -7 },
  watcher: { borderWidth: 2, borderRadius: 9, overflow: "hidden" },
  cover: { width: 22, height: 30, borderRadius: 7, borderWidth: 2 },
  more: { marginLeft: 6, fontSize: 11, fontWeight: "700" },
  loadingPill: { flexGrow: 0, width: 150 },
  loadingFace: { width: FACE_SIZE, height: FACE_SIZE, borderRadius: FACE_RADIUS, marginLeft: 2 },
  loadingBars: { gap: 6 },
  loadingBar: { width: 64, height: 8, borderRadius: 4 },
  loadingBarShort: { width: 44 },
  progressTrack: { position: "absolute", left: 8, right: 8, bottom: 4, height: 2, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 2 },
  retry: { width: FACE_SIZE, height: FACE_SIZE, borderRadius: FACE_RADIUS, alignItems: "center", justifyContent: "center" },
});

export default React.memo(StoryShelf);
