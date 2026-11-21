/**
 * The Glass Shelf: one row of tall glass tiles at the top of Home. Port of
 * web's `components/app/stories/StoryShelf`.
 *
 * "Your day" first (+ to share a moment, or watch your own), then everyone
 * live right now (it replaces the Live now row), then people's moments: new
 * ones carry a ring in the theme's colours, watched ones go grey and move to
 * the end. Each tile blurs the story cover behind the avatar.
 */
import React, { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
import { useLiveNowItems, pictureOf, type LiveNowItem } from "../Home/LiveNowBar";
import { getStoryShelf, type ShelfEntry } from "../../services/stories.service";
import { openStoryCreator, openStoryViewer, storiesState, type PendingMoment } from "../../store/stories.store";
import { ageLabel, avatarOf, coverOf, nameOf, playable } from "./story-utils";
import { getAvatarUrl } from "../../libs/misc";

const TILE_W = 86;
const TILE_H = 118;

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

/** Themes with a colored outline use a gradient behind the story tile. */
function useRingGradient(): [string, string] | null {
  const { theme } = useAppTheme();
  switch (theme) {
    case "hazy":
      return ["#A391FC", "#F39BFF"];
    case "osaka":
      return ["#FF6FB1", "#7FE3E0"];
    case "jungle":
      return ["#9BE15D", "#00E3AE"];
    case "war":
      return ["#E8B04A", "#E8B04A"];
    default:
      return null;
  }
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
  const { data } = useStoryShelf(me, liveHosts, canSeeMature, storiesEnabled || !!liveHosts);
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
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={failed ? () => pending?.retry?.() : entry ? onOpen : onAdd}
      accessibilityLabel={name}
      style={styles.tile}
    >
      <Face uri={avatar} name={name} cover={pending ? pending.preview : entry && coverOf(entry)} />
      <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.6)"]} style={styles.shade} pointerEvents="none" />
      {pending && !failed ? (
        <View style={styles.progressTrack} pointerEvents="none">
          <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(pending.progress * 100))}%` }]} />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.retry}>
            <Icon name="RotateCcw" size={18} color="#fff" />
          </View>
        </View>
      ) : null}
      <TouchableOpacity onPress={onAdd} hitSlop={8} style={styles.plus} accessibilityLabel={t("stories.addMoment", { defaultValue: "Add a moment" })}>
        <Icon name="Plus" size={16} color="#000" strokeWidth={2.6} />
      </TouchableOpacity>
      <Text style={styles.name} numberOfLines={1}>
        {failed
          ? t("stories.tapRetry", { defaultValue: "Tap to retry" })
          : pending || processing
            ? t("stories.sharing", { defaultValue: "Sharing…" })
            : name}
      </Text>
    </TouchableOpacity>
  );
}

function LiveTile({ item, onOpen }: { item: LiveNowItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const { theme, isLight } = useAppTheme();
  const tone = theme === "osaka" ? "#FFB05C" : isLight ? "#E04046" : "#FF6363";
  const pic = pictureOf(item);
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onOpen} accessibilityLabel={item.title} style={[styles.tile, styles.liveTile, { borderColor: tone }]}>
      {pic ? <Image source={{ uri: pic }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : null}
      <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.65)"]} style={styles.shade} pointerEvents="none" />
      <View style={[styles.livePill, { backgroundColor: tone }]}>
        <Text style={styles.livePillText}>{t("stages.live")}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {item.displayName || item.username || item.title}
      </Text>
    </TouchableOpacity>
  );
}

/** Keep the creator visible over the blurred opening frame. */
function Face({ uri, name, cover }: { uri: string | null; name: string; cover: string | null }) {
  return (
    <>
      {cover ? <Image source={{ uri: cover }} recyclingKey={cover} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={22} cachePolicy="memory-disk" /> : null}
      <View style={styles.frost} pointerEvents="none" />
      <View style={styles.face} pointerEvents="none">
        <Avatar uri={uri} size={52} radius={26} name={name} />
      </View>
    </>
  );
}

function PersonTile({ entry, onOpen }: { entry: ShelfEntry; onOpen: () => void }) {
  const ring = useRingGradient();
  const face = avatarOf(entry.author, 96);
  const latest = entry.items[entry.items.length - 1];
  const fresh = !entry.seen;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onOpen} accessibilityLabel={nameOf(entry.author)} style={styles.tileBox}>
      {fresh && ring ? <LinearGradient colors={ring} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ring} /> : null}
      <View style={[styles.tile, fresh ? styles.inRing : styles.seen]}>
        <Face uri={face} cover={coverOf(entry)} name={entry.author.username || entry.author.address} />
        <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.62)"]} style={styles.shade} pointerEvents="none" />
        {latest ? (
          <View style={styles.age}>
            <Text style={styles.ageText}>{ageLabel(latest.createdAt)}</Text>
          </View>
        ) : null}
        <Text style={styles.name} numberOfLines={1}>
          {entry.author.username ? `@${entry.author.username}` : nameOf(entry.author)}
        </Text>
        {!fresh || !ring ? <View style={styles.smokeLine} pointerEvents="none" /> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, marginBottom: 8, flexGrow: 0 },
  row: { gap: 8, paddingVertical: 2 },
  tileBox: { width: TILE_W, height: TILE_H },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(127,127,127,0.18)",
  },
  ring: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16 },
  inRing: {
    position: "absolute",
    top: 2,
    left: 2,
    width: TILE_W - 4,
    height: TILE_H - 4,
    borderRadius: 14,
  },
  smokeLine: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#66686DBA",
  },
  seen: { opacity: 0.55 },
  liveTile: { borderWidth: 2 },
  shade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },
  name: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    color: "#fff",
    fontSize: 11.5,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 4,
  },
  frost: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.18)" },
  face: { position: "absolute", top: 30, left: 0, right: 0, alignItems: "center" },
  age: {
    position: "absolute",
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  ageText: { color: "#fff", fontSize: 10, fontWeight: "600" },
  plus: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  progressTrack: { position: "absolute", left: 8, right: 8, bottom: 28, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden" },
  progressFill: { height: 3, backgroundColor: "#fff" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  retry: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  livePill: { position: "absolute", top: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  livePillText: { color: "#fff", fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
});

export default React.memo(StoryShelf);
