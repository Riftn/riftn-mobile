/**
 * LiveNowBar — one thin row at the top of the home feed for everyone live
 * =====================================================================
 * Port of web's `components/app/feeds/LiveNowBar`. Stage hosts and people
 * livestreaming share one frosted row over the live picture itself, people
 * you follow first, then the busiest. With one person live the row names their room and
 * a tap goes straight in; with more it reads "Live now" and a tap opens a
 * sheet listing every Stage and stream.
 *
 * @module components/Home/LiveNowBar
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import MaskedView from "@react-native-masked-view/masked-view";
import Svg, { Path } from "react-native-svg";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useAmbientMotion } from "../../hooks/useAmbientMotion";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";

import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import GlassModal from "../ui/GlassModal";
import { useStages } from "../../context/StageContext";
import { useUser } from "../../context/AuthContext";
import { liveStreamsQuery, liveStreamRows } from "../../hooks/useLiveStreams";
import { getFollowList } from "../../services/user.service";
import { isStreamLive } from "../../libs/live-status";
import { buildCdnPath, getAvatarUrl, getBadgeHoverOpticalStyle, getBadgeUrlFor, storedAvatarSources } from "../../libs/misc";
import BadgeArtwork from "../common/BadgeArtwork";
import AccountBadge from "../common/AccountBadge";
import { liveThumbnailFor } from "../../libs/live-ingest";
import { useAppTheme } from "../../context/ThemeContext";
import { compactCount } from "../Music/CinematicMusic";
import { watchingNow } from "../../libs/viewers.util";
import { ScreenNames } from "../../navigation/ScreenNames";

export interface LiveNowItem {
  kind: "stage" | "stream";
  id: string;
  tokenId?: number;
  title: string;
  wallet: string;
  username: string | null;
  /** Stored avatar path (Stage host) or ready URL (streamer). */
  avatar: string | null;
  /**
   * How many are in it right now, ready to show ("8"), or empty when the
   * list did not say. This used to be a stream's total joins, so a live with
   * 8 people in it read 32 next to LIVE and nobody could tell what it meant.
   */
  count: string;
  followed: boolean;
  size: number;
  /** A frame of the broadcast when the stream has one; Stages never do. */
  cover?: string | null;
  /** Name shown before the badge; the handle when there is none. */
  displayName?: string | null;
  /** Staking badge art when the row carried the account (streams); Stages look it up by wallet. */
  badge?: number;
}

const handleOf = (item: LiveNowItem) => `@${item.username || item.wallet?.slice(0, 6) || "?"}`;

/**
 * Everyone live right now (Stages and video streams), people you follow
 * first, and how to open one. Shared by the Home bar and Explore's list.
 */
export function useLiveNowItems(onBeforeOpen?: () => void) {
  const navigation = useNavigation<any>();
  const user = useUser();
  const me = (user?.walletAddress || user?.address || "").toLowerCase();
  const { liveSpaces, openModal, joinSpace, guestListenSpace } = useStages();

  // Same request and cache entry as the Live tab and useLiveStreams.
  const { data: liveData } = useQuery(liveStreamsQuery);

  const { data: following } = useQuery({
    queryKey: ["following-list-for-live-bar", me],
    queryFn: async () => {
      const res = await getFollowList({ address: me, type: "following", limit: 3000 });
      return (res?.result?.items ?? []).map((i) => i.user?.address?.toLowerCase()).filter(Boolean) as string[];
    },
    enabled: !!me,
    staleTime: 2 * 60_000,
  });

  const items = useMemo(() => {
    const set = new Set(following ?? []);
    const isFollowed = (addr?: string | null) => !!addr && addr.toLowerCase() !== me && set.has(addr.toLowerCase());

    const list: LiveNowItem[] = liveSpaces.map((space) => {
      const size = (space.speaker_count || 1) + (space.listener_count || 0);
      return {
        kind: "stage",
        id: String(space.id),
        title: space.title,
        wallet: space.host_wallet_address,
        username: space.host_username ?? null,
        avatar: space.host_avatar ?? null,
        count: compactCount(size),
        followed: isFollowed(space.host_wallet_address),
        size,
      };
    });

    const seen = new Set<string>();
    liveStreamRows(liveData).forEach((row: any, index) => {
      if (!isStreamLive(row)) return;
      const id = String(row._id || row.streamId || index);
      if (seen.has(id)) return;
      seen.add(id);
      const account = row.account || row.streamer;
      const avatarPath = account?.avatarImageUrl || account?.avatarUrl;
      const watching = watchingNow(row);
      const wallet = String(row.address || account?.address || "");
      const rawThumb: string | undefined = row.thumbnail || row.thumbnailUrl;
      const cover = rawThumb
        ? rawThumb.startsWith("http") ? rawThumb : buildCdnPath(rawThumb) ?? null
        : liveThumbnailFor(row) ?? null;
      list.push({
        kind: "stream",
        id,
        tokenId: row.tokenId,
        title: row.title,
        wallet,
        username: account?.username ?? null,
        avatar: avatarPath ? getAvatarUrl(avatarPath, 48) : null,
        count: watching == null ? "" : compactCount(watching),
        followed: isFollowed(wallet),
        size: watching ?? 0,
        cover,
        displayName: account?.displayName ?? null,
        badge: account && !account.hideBadgeAndBalance ? getBadgeUrlFor(account) : undefined,
      });
    });

    return list.sort((a, b) => Number(b.followed) - Number(a.followed) || b.size - a.size);
  }, [liveSpaces, liveData, following, me]);

  const open = useCallback(
    async (item: LiveNowItem) => {
      onBeforeOpen?.();
      if (item.kind === "stage") {
        // Same path as a /stages/<id> deep link: join (or listen as a guest
        // when signed out), then open the room that was actually tapped.
        if ((await joinSpace(item.id)) || (await guestListenSpace(item.id))) openModal("live");
      } else {
        navigation.navigate(ScreenNames.LiveViewer, {
          streamId: item.id,
          isLive: true,
          ...(item.tokenId != null ? { tokenId: item.tokenId } : {}),
        });
      }
    },
    [joinSpace, guestListenSpace, openModal, navigation, onBeforeOpen],
  );

  return { items, open };
}

const LiveNowBar: React.FC = () => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const { items, open } = useLiveNowItems(closeSheet);

  if (items.length === 0) return null;

  return (
    <>
      <LiveNowRow items={items} onOpen={open} onSeeAll={() => setSheetOpen(true)} />
      {items.length > 1 && (
        <GlassModal surface="theme" visible={sheetOpen} onClose={() => setSheetOpen(false)} presentation="bottom" scrollable maxHeight="70%">
          <LiveNowSheet items={items} onOpen={open} />
        </GlassModal>
      )}
    </>
  );
};

function faceSources(item: LiveNowItem, size: number) {
  return item.kind === "stage"
    ? storedAvatarSources(item.avatar, item.wallet, size)
    : { uri: item.avatar, fallbackUri: null };
}

export function LiveFace({ item, size, live = true, radius }: { item: LiveNowItem; size: number; live?: boolean; radius?: number }) {
  return <Avatar {...faceSources(item, size)} size={size} radius={radius} name={item.username || item.wallet} live={live} />;
}

/** What the glass shows: the broadcast when there is a picture, else the host's face. */
export function pictureOf(item: LiveNowItem): string | undefined {
  return item.cover || faceSources(item, 96).uri || undefined;
}

/** LIVE, then who is in it in words: "8 watching" on a stream, "5 here" on a Stage. */
export function LiveCount({ item }: { item: LiveNowItem }) {
  const { t } = useTranslation();
  return (
    <View style={styles.live}>
      <Text style={styles.liveText}>{t("stages.live")}</Text>
      {item.count ? (
        <Text style={styles.count} numberOfLines={1}>
          {t(item.kind === "stage" ? "liveViewer.hereCount" : "liveViewer.watchingCount", { formatted: item.count })}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The single row. Exported for the shot harness.
 *
 * Frosted glass over the broadcast itself: the live picture (or the host's
 * face when there is no picture) sits blurred behind the row, a small still
 * on the left carries the face on its corner, and one soft dot breathes by
 * the count. No ping, no red rings. Same as web's LiveNowRow.
 */
export function LiveNowRow({
  items,
  onOpen,
  onSeeAll,
}: {
  items: LiveNowItem[];
  onOpen: (item: LiveNowItem) => void;
  onSeeAll: () => void;
}) {
  const { t } = useTranslation();
  const { isLight, theme } = useAppTheme();
  const single = items.length === 1 ? items[0] : null;
  const names = items.slice(0, 2).map(handleOf);
  const rest = items.length - names.length;
  const glassUri = pictureOf(items.find((item) => item.cover) ?? items[0]);
  const tone = theme === "osaka" ? "#FFB05C" : isLight ? "#E04046" : "#FF6363";
  // Written dark: System Light's colour pass turns this veil white.
  const veil = isLight ? "rgba(8,8,10,0.62)" : theme === "osaka" ? "rgba(17,14,28,0.6)" : "rgba(8,8,10,0.5)";

  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={() => (single ? onOpen(single) : onSeeAll())} activeOpacity={0.85} style={styles.row}>
        {/* One picture behind the glass: the first stream's frame (or face). Native
            blurs each image on its own, so several side by side showed seams. */}
        <View style={styles.glass} pointerEvents="none">
          {glassUri ? (
            <Image source={{ uri: glassUri }} style={styles.glassPart} contentFit="cover" blurRadius={24} cachePolicy="memory-disk" transition={200} />
          ) : null}
        </View>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: veil }]} pointerEvents="none" />

        {single ? (
          <LiveStill item={single} />
        ) : (
          <View style={styles.fan}>
            {items.slice(0, 3).reverse().map((item, i, arr) => (
              <View key={`${item.kind}-${item.id}`} style={[styles.fanItem, fanStyle(i, arr.length)]}>
                <LiveStill item={item} small />
              </View>
            ))}
          </View>
        )}

        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {single ? single.title : t("stages.liveNow")}
          </Text>
          <View style={styles.subRow}>
            {single ? (
              <>
                {single.kind === "stage" ? <Text style={styles.sub}>{t("stages.hostedBy")} </Text> : null}
                <NameWithBadge item={single} />
                {single.displayName ? (
                  <Text style={[styles.sub, styles.shrink]} numberOfLines={1}>
                    {handleOf(single)}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                {items.slice(0, 2).map((item, i) => (
                  <React.Fragment key={`${item.kind}-${item.id}`}>
                    <NameWithBadge item={item} />
                    {i === 0 ? <Text style={styles.sub}>, </Text> : null}
                  </React.Fragment>
                ))}
                {rest > 0 ? <Text style={styles.sub}> +{rest}</Text> : null}
              </>
            )}
          </View>
        </View>

        <View style={styles.meta}>
          <BreathingDot color={tone} />
          {single ? (
            <Text style={styles.metaText} numberOfLines={1}>
              {single.count
                ? t(single.kind === "stage" ? "liveViewer.hereCount" : "liveViewer.watchingCount", { formatted: single.count })
                : t("stages.live")}
            </Text>
          ) : (
            <>
              <Text style={styles.metaText}>{t("stages.seeAll")}</Text>
              <Icon name="ChevronRight" size={12} color="rgba(255,255,255,0.75)" />
            </>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );
}

/** Display name (or handle) with the staking badge right after it. */
function NameWithBadge({ item }: { item: LiveNowItem }) {
  return (
    <View style={styles.nameBadge}>
      <Text style={[styles.sub, styles.subName]} numberOfLines={1}>
        {item.displayName || handleOf(item)}
      </Text>
      {item.badge != null ? (
        <BadgeArtwork
          source={item.badge}
          style={[getBadgeHoverOpticalStyle(item.badge, BADGE_SIZE, 0, SUB_LINE), { marginLeft: 3 }]}
          contentFit="contain"
        />
      ) : item.kind === "stage" ? (
        <AccountBadge lookupId={item.username || item.wallet} size={BADGE_SIZE} lineHeight={SUB_LINE} />
      ) : null}
    </View>
  );
}

const BADGE_SIZE = 12;
const SUB_LINE = 15;

function fanStyle(i: number, count: number) {
  if (count === 1) return { left: 0 };
  const steps = [
    { left: 0, opacity: 0.75, transform: [{ rotate: "-5deg" }, { scale: 0.9 }] },
    { left: 10, transform: [{ rotate: "-2deg" }, { scale: 0.95 }] },
    { left: 20 },
  ];
  return steps[count === 2 ? i + 1 : i];
}

/** The 56x34 still with the face's corner cut out: the face's own shape (20px, radius 6) grown by a 1.5px gap. */
const NOTCH_PATH =
  "M0 0H56V34H0Z M47 16.5H55A7.5 7.5 0 0 1 62.5 24V32A7.5 7.5 0 0 1 55 39.5H47A7.5 7.5 0 0 1 39.5 32V24A7.5 7.5 0 0 1 47 16.5Z";
function CornerNotch() {
  return (
    <Svg width={56} height={34} viewBox="0 0 56 34">
      <Path d={NOTCH_PATH} fill="#000" fillRule="evenodd" />
    </Svg>
  );
}

/** Small 16:9 frame: the broadcast still with the face on its corner, or the face alone in soft focus. */
function LiveStill({ item, small = false }: { item: LiveNowItem; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cover = !broken ? item.cover : null;
  const frame = small ? styles.stillSmall : styles.still;
  if (cover) {
    const picture = <Image source={{ uri: cover }} style={frame} contentFit="cover" cachePolicy="memory-disk" onError={() => setBroken(true)} />;
    if (small) return picture;
    // No border round the face (it read as a black ring on dark themes). The
    // still is cut away around the face with a thin 1.5px gap instead, so the
    // glass shows through between them. Same notch as web's live-now-glass.css.
    return (
      <View>
        <MaskedView style={frame} maskElement={<CornerNotch />}>
          {picture}
        </MaskedView>
        <View style={styles.corner}>
          <LiveFace item={item} size={20} radius={6} live={false} />
        </View>
      </View>
    );
  }
  const face = faceSources(item, 96).uri;
  return (
    <View style={[frame, styles.faceFrame]}>
      {face ? <Image source={{ uri: face }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={10} /> : null}
      {!small && <LiveFace item={item} size={24} live={false} />}
    </View>
  );
}

/**
 * One soft dot that breathes every 3 seconds, only while the bar is on
 * screen. The bar sits on Home, which stays mounted under Shorts and every
 * other pushed screen: the endless loop kept Android's UI thread committing
 * a frame for it the whole time, behind a playing short.
 */
function BreathingDot({ color }: { color: string }) {
  const p = useSharedValue(0);
  const running = useAmbientMotion();
  useEffect(() => {
    if (!running) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(p);
  }, [p, running]);
  const halo = useAnimatedStyle(() => ({ opacity: p.value * 0.22, transform: [{ scale: 1 + p.value * 0.9 }] }));
  const core = useAnimatedStyle(() => ({ opacity: 0.75 + p.value * 0.25 }));
  return (
    <View style={styles.dotBox}>
      <Animated.View style={[styles.dotHalo, { backgroundColor: color }, halo]} />
      <Animated.View style={[styles.dot, { backgroundColor: color }, core]} />
    </View>
  );
}

/** The sheet: every Stage and stream, one row each. Exported for the shot harness. */
export function LiveNowSheet({ items, onOpen }: { items: LiveNowItem[]; onOpen: (item: LiveNowItem) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <View style={styles.liveDot} />
        <Text style={styles.sheetTitle}>{t("stages.liveNow")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {items.map((item) => (
          <TouchableOpacity
            key={`${item.kind}-${item.id}`}
            onPress={() => onOpen(item)}
            activeOpacity={0.85}
            style={[styles.row, styles.sheetRow]}
          >
            <Icon name={item.kind === "stage" ? "Mic" : "Video"} size={18} color="rgba(255,255,255,0.8)" />
            <LiveFace item={item} size={32} />
            <View style={styles.text}>
              <Text style={[styles.title, styles.sheetRowTitle]} numberOfLines={1}>
                {item.title}
              </Text>
              <View style={styles.subRow}>
                {item.kind === "stage" ? <Text style={styles.sub}>{t("stages.hostedBy")} </Text> : null}
                <NameWithBadge item={item} />
              </View>
            </View>
            <LiveCount item={item} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // The nav pill's reserved space already leaves 6 above this row and the
  // first card adds its own 6 margin below, so 6 more each side makes the gap
  // above and below the same 12.
  wrap: {
    marginTop: 6,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  glass: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    transform: [{ scale: 1.35 }],
  },
  glassPart: {
    flex: 1,
    height: "100%",
  },
  still: {
    width: 56,
    height: 34,
    borderRadius: 8,
  },
  stillSmall: {
    width: 48,
    height: 30,
    borderRadius: 7,
  },
  faceFrame: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  corner: {
    position: "absolute",
    right: -5,
    bottom: -4,
    borderRadius: 6,
    overflow: "hidden",
  },
  fan: {
    width: 70,
    height: 36,
  },
  fanItem: {
    position: "absolute",
    top: 3,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11.5,
    fontWeight: "600",
  },
  dotBox: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotHalo: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontWeight: "700",
  },
  sub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11.5,
    lineHeight: SUB_LINE,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    overflow: "hidden",
  },
  nameBadge: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
  },
  subName: {
    color: "rgba(255,255,255,0.85)",
    fontWeight: "500",
    flexShrink: 1,
  },
  shrink: {
    flexShrink: 1,
    marginLeft: 4,
    color: "rgba(255,255,255,0.5)",
  },
  host: {
    color: "rgba(255,255,255,0.7)",
  },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },
  liveText: {
    color: "#F87171",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    marginRight: 2,
  },
  count: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
  },
  seeAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  seeAllText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "500",
  },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sheetTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
  },
  list: {
    gap: 8,
  },
  sheetRow: {
    paddingVertical: 10,
  },
  sheetRowTitle: {
    fontSize: 13,
  },
});

export default React.memo(LiveNowBar);
