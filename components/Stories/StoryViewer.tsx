/**
 * Full-screen moments viewer. Port of web's `components/app/stories/StoryViewer`.
 *
 * Tap right/left for the next or last moment, hold to pause, swipe down to
 * close, swipe sideways for the next person. Photos follow the author’s timer, videos their
 * length. Like and reply (a reply is a DM); owners see views and likes and who
 * watched, and can delete. Dark in every theme.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { type InfiniteData, type UseInfiniteQueryResult, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import ShareToDmSheet from "../DM/ShareToDmSheet";
import { DarkRoomProvider, useAppTheme } from "../../context/ThemeContext";
import { useUser, useAuthActions } from "../../context/AuthContext";
import { useWebSocketApi } from "../../context/WebSocketContext";
import { ScreenNames } from "../../navigation/ScreenNames";
import { WEBSITE_LINK } from "../../config/links";
import { formatCount } from "../../libs/format-count";
import { releaseAudioFocus, requestAudioFocus } from "../../libs/audioFocus";
import { revokeAllFeedVideo } from "../../libs/feedVideoFocus";
import { getPictureInPicturePlayer } from "../../libs/pictureInPicture";
import { stopActivePreview } from "../../libs/previewRegistry";
import { visualActivity } from "../../libs/visualActivity";
import { toastError, toastSuccess } from "../../libs/toast";
import { muteUser } from "../../services/mute.service";
import { followUser, unfollowUser } from "../../services/user.service";
import {
  deleteStory,
  getStory,
  getStoryViewers,
  likeStory,
  markStoryViewed,
  reportStory,
  type ShelfEntry,
  type StoryItem,
} from "../../services/stories.service";
import { openStoryCreator, openStoryViewer } from "../../store/stories.store";
import { ageLabel, avatarOf, nameOf, startIndex } from "./story-utils";
import StoryComments from "./StoryComments";
import { sendStoryReply } from "./story-reply";
import MomentCaption from "./MomentCaption";
import { MomentComment, MomentHeart, MomentShare } from "./MomentIcons";
import { FloatHearts, StoryRoomChat, TEXT_SHADOW, useMomentComments } from "./StoryRoom";
import { ChromeFill, CHROME_HAIRLINE } from "../common/ViewerChrome";

/** Themes with their own key colour wear it on the MOMENT tag and Send, as on web. */
const ACCENT_THEMES = new Set(["hazy", "osaka", "jungle", "cosmic", "glass", "lavalamp", "swarms", "winter", "island", "horror", "hacker"]);

/** "21h left", "40m left": how long until the moment goes away. */
function timeLeftLabel(expiresAt: string, t: (k: string, o: Record<string, unknown>) => string): string {
  const mins = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60000));
  if (mins >= 60) return t("stories.hoursLeft", { n: Math.floor(mins / 60), defaultValue: "{{n}}h left" });
  return t("stories.minutesLeft", { n: Math.max(1, mins), defaultValue: "{{n}}m left" });
}

/** A white icon with a soft shadow, like the live header (SVG casts none on Android). */
function ShadowedIcon({ name, size }: { name: React.ComponentProps<typeof Icon>["name"]; size: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <View pointerEvents="none" style={{ position: "absolute", top: 1, left: 0 }}>
        <Icon name={name} size={size} color="rgba(0,0,0,0.45)" />
      </View>
      <Icon name={name} size={size} color="#fff" />
    </View>
  );
}

const DEFAULT_PHOTO_MS = 5000;
const TICK_MS = 50;

type Sheet = null | "more" | "viewers" | "comments" | "report" | "delete" | "share" | "share-dm";

export default function StoryViewer({
  entries,
  index: firstIndex,
  openComments = false,
  onOpenProfile,
  onClose,
}: {
  entries: ShelfEntry[];
  index: number;
  openComments?: boolean;
  onOpenProfile: (address: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const ws = useWebSocketApi();
  const queryClient = useQueryClient();
  const user = useUser();
  const { requireAuth } = useAuthActions();
  const { theme, colors } = useAppTheme();
  const accent = ACCENT_THEMES.has(theme) ? colors.accent : "#fff";
  const me = (user?.walletAddress || user?.address || "").toLowerCase();

  const [list, setList] = useState(entries);
  const [authorIdx, setAuthorIdx] = useState(firstIndex);
  const [itemIdx, setItemIdx] = useState(() => (entries[firstIndex] ? startIndex(entries[firstIndex]) : 0));
  const entry = list[authorIdx];
  const snapshot: StoryItem | undefined = entry?.items[itemIdx];
  // An archived thread was opened under its owner's session.
  const archivedThread = openComments && snapshot && (snapshot.expired || Date.parse(snapshot.expiresAt) <= Date.now());
  const archiveOwnerChanged = archivedThread && entry?.author.address.toLowerCase() !== me;
  const customAudience = snapshot?.audience === 'selected' || snapshot?.audience === 'except' || snapshot?.audience === 'close_friends';
  const delivery = useQuery({
    queryKey: ['private-story-playback', snapshot?.id, me],
    queryFn: () => getStory(snapshot!.id, true),
    enabled: customAudience && !!me,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 4 * 60 * 1000,
    retry: false,
  });
  const item = useMemo(() => {
    if (archiveOwnerChanged) return undefined;
    if (!customAudience) return snapshot;
    if (!snapshot || !me || !delivery.isSuccess) return undefined;
    const { mediaUrl, posterUrl, overlayUrl } = delivery.data.item;
    return { ...snapshot, mediaUrl, posterUrl, overlayUrl };
  }, [snapshot, customAudience, archiveOwnerChanged, me, delivery.data, delivery.isSuccess]);
  useEffect(() => {
    if (archiveOwnerChanged || (customAudience && (!me || delivery.isError))) onClose();
  }, [archiveOwnerChanged, customAudience, me, delivery.isError, onClose]);
  const own = !!entry && (entry.own || entry.author.address.toLowerCase() === me);

  const [progress, setProgress] = useState(0);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const loaded = !!item && loadedId === item.id;
  const [held, setHeld] = useState(false);
  // A Moment made from a post keeps "Go to post" out of the way until the
  // viewer taps the post in the middle of the screen; that tap also holds
  // the Moment so there is time to press it.
  const [postPeekId, setPostPeekId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(openComments ? "comments" : null);
  const [muted, setMuted] = useState(false);
  const [reply, setReply] = useState("");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [openingOriginal, setOpeningOriginal] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [bursts, setBursts] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const sendingReply = useRef(false);
  const replyInput = useRef<TextInput>(null);
  const audience = useInfiniteQuery({
    queryKey: ["moment-viewers", item?.id, me],
    queryFn: ({ pageParam }) => getStoryViewers(item!.id, pageParam),
    enabled: !!item && own && !!me && sheet === "viewers",
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.next ?? undefined,
    refetchInterval: () => item && Date.parse(item.expiresAt) > Date.now() ? 10_000 : false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
  });
  const viewCount = audience.data?.pages[0]?.viewCount ?? item?.viewCount ?? 0;
  const viewsLabel = t("stories.viewsCount", { defaultValue: "{{formatted}} views", formatted: formatCount(viewCount) });
  const room = useMomentComments(item?.id, !!me, !!item && (item.commentCount ?? 1) > 0);
  const roomComments = room.data?.comments ?? [];
  const originalRequest = useRef<symbol | null>(null);
  const postPeek = item?.postTokenId != null && postPeekId === item.id;
  const appForeground = useSyncExternalStore(visualActivity.subscribe, visualActivity.isAppForeground, () => true);
  const paused = !appForeground || held || postPeek || typing || sending || sheet !== null || openingOriginal || !loaded;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // ── Moving through moments ──
  const goAuthor = useCallback(
    (dir: 1 | -1) => {
      const next = authorIdx + dir;
      if (next < 0 || next >= list.length) {
        onClose();
        return;
      }
      setAuthorIdx(next);
      setItemIdx(dir === 1 ? startIndex(list[next]) : 0);
    },
    [authorIdx, list, onClose],
  );
  const goItem = useCallback(
    (dir: 1 | -1) => {
      if (!entry) return;
      const next = itemIdx + dir;
      if (next < 0) return dir === -1 && authorIdx > 0 ? goAuthor(-1) : setProgress(0);
      if (next >= entry.items.length) return goAuthor(1);
      setItemIdx(next);
    },
    [entry, itemIdx, authorIdx, goAuthor],
  );

  const elapsed = useRef(0);
  // Deleting a Moment can replace it at the same index. Its successor still
  // needs a fresh clock and reply, even when neither list index changes.
  useEffect(() => {
    elapsed.current = 0;
    setProgress(0);
    setReply("");
    setTyping(false);
    setOpeningOriginal(false);
    return () => { originalRequest.current = null; };
  }, [snapshot?.id]);

  // Photo clock.
  const goItemRef = useRef(goItem);
  goItemRef.current = goItem;
  useEffect(() => {
    if (!item || item.type === "video" || paused) return;
    const id = setInterval(() => {
      elapsed.current += TICK_MS;
      const p = Math.min(1, elapsed.current / Math.max(1000, item.durationMs || DEFAULT_PHOTO_MS));
      setProgress(p);
      if (p >= 1) {
        clearInterval(id);
        goItemRef.current(1);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [item, paused]);

  // Video.
  const videoUri = item?.type === "video" ? item.mediaUrl : null;
  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1;
  });
  useEffect(() => {
    if (!videoUri || !item) return;
    const id = item.id;
    const subs = [
      player.addListener("statusChange", ({ status }: { status: string }) => {
        if (status === "readyToPlay" || status === "error") setLoadedId(id);
      }),
      player.addListener("timeUpdate", ({ currentTime }: { currentTime: number }) => {
        const d = player.duration || item.durationMs / 1000;
        if (d > 0) setProgress(Math.min(1, currentTime / d));
      }),
      player.addListener("playToEnd", () => { if (!pausedRef.current) goItemRef.current(1); }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player, videoUri, item]);
  useEffect(() => {
    if (!videoUri) return;
    try {
      player.muted = muted || !!item?.muted;
      if (paused && loaded) player.pause();
      else if (loaded) player.play();
    } catch {
      /* not loaded yet */
    }
  }, [player, videoUri, paused, loaded, muted, item?.muted]);

  // Song beside the picture.
  const songUri = item?.song?.audioUrl ? item.song.audioUrl.split("#")[0] : null;
  const song = useAudioPlayer(songUri ? { uri: songUri } : null);
  const stopStoryMedia = useRef(() => {});
  stopStoryMedia.current = () => {
    try { if (videoUri) player.pause(); } catch {}
    try { if (songUri) song.pause(); } catch {}
  };
  useLayoutEffect(() => {
    revokeAllFeedVideo();
    stopActivePreview();
    try { getPictureInPicturePlayer()?.pause(); } catch {}
    const stop = () => stopStoryMedia.current();
    requestAudioFocus(stop);
    return () => {
      stop();
      releaseAudioFocus(stop);
    };
  }, []);

  useEffect(() => {
    if (!songUri) return;
    try {
      song.loop = true;
      song.muted = muted;
      if (paused) song.pause();
      else song.play();
    } catch {
      /* not loaded yet */
    }
  }, [song, songUri, paused, muted]);
  useEffect(() => {
    if (!songUri || !item?.song) return;
    try {
      void song.seekTo((item.song.startMs || 0) / 1000);
    } catch {
      /* ignore */
    }
  }, [song, songUri, item?.id, item?.song]);

  // Counted once it is on screen.
  const viewedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!item || !loaded || own || !me || viewedRef.current.has(item.id)) return;
    viewedRef.current.add(item.id);
    markStoryViewed(item.id).catch(() => {});
    setList((l) =>
      l.map((e, i) =>
        i !== authorIdx
          ? e
          : { ...e, items: e.items.map((x) => (x.id === item.id ? { ...x, viewed: true } : x)), seen: e.items.every((x) => x.viewed || x.id === item.id) },
      ),
    );
  }, [item, loaded, own, me, authorIdx]);

  useEffect(() => () => {
    void queryClient.invalidateQueries({ queryKey: ["story-shelf"] });
  }, [queryClient]);

  // Swipe up on your moment for viewers, down to close, or sideways to change person.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => !sheet && !typing && !openingOriginal && (Math.abs(g.dy) > 14 || Math.abs(g.dx) > 14),
        onPanResponderGrant: () => setHeld(true),
        onPanResponderRelease: (_e, g) => {
          setHeld(false);
          if (g.dy > 90 && Math.abs(g.dy) > Math.abs(g.dx)) onClose();
          else if (own && g.dy < -90 && Math.abs(g.dy) > Math.abs(g.dx)) setSheet("viewers");
          else if (g.dx < -70 && Math.abs(g.dx) > Math.abs(g.dy)) goAuthor(1);
          else if (g.dx > 70 && Math.abs(g.dx) > Math.abs(g.dy)) goAuthor(-1);
        },
        onPanResponderTerminate: () => setHeld(false),
      }),
    [onClose, goAuthor, own, sheet, typing, openingOriginal],
  );

  if (!entry || !item) return null;
  const width = Dimensions.get("window").width;
  const isLiked = liked[item.id] ?? item.liked;
  const shareable = item.shareable && Date.parse(item.expiresAt) > Date.now();
  const momentUrl = `${WEBSITE_LINK}/app/moment/${encodeURIComponent(item.id)}`;

  const remix = () => {
    const source = { id: item.id, name: nameOf(entry.author) };
    if (!me) onClose();
    requireAuth(() => {
      openStoryCreator(source);
      onClose();
    });
  };

  const copyLink = async () => {
    try {
      const copied = await Clipboard.setStringAsync(momentUrl);
      if (!copied) throw new Error("Clipboard unavailable");
      setSheet(null);
      toastSuccess(t("stories.linkCopied", { defaultValue: "Link copied" }));
    } catch {
      toastError(t("stories.copyLinkFailed", { defaultValue: "Couldn't copy the moment link." }));
    }
  };
  const shareOutside = () => {
    void Share.share(Platform.OS === "ios" ? { url: momentUrl } : { message: momentUrl })
      .then(() => setSheet(null))
      .catch(() => { void copyLink(); });
  };

  const openOriginal = async () => {
    if (!item.remixSourceId || originalRequest.current) return;
    const request = Symbol();
    originalRequest.current = request;
    setOpeningOriginal(true);
    try {
      const { author, item: original } = await getStory(item.remixSourceId, !!me);
      if (originalRequest.current !== request) return;
      if (!author || !original.shareable || Date.parse(original.expiresAt) <= Date.now()) {
        throw new Error("Original moment unavailable");
      }
      openStoryViewer(
        [{ author, own: author.address.toLowerCase() === me, following: false, seen: original.viewed, latestAt: original.createdAt, items: [original] }],
        0,
        true,
      );
    } catch {
      if (originalRequest.current === request) toastError(t("stories.originalUnavailable", { defaultValue: "The original moment is no longer available." }));
    } finally {
      if (originalRequest.current === request) {
        originalRequest.current = null;
        setOpeningOriginal(false);
      }
    }
  };

  const followAuthor = () =>
    requireAuth(() => {
      const address = entry.author.address;
      setList((l) => l.map((e) => (e.author.address === address ? { ...e, following: true } : e)));
      followUser(me, address)
        .then(() => { void queryClient.invalidateQueries({ queryKey: ["story-shelf"] }); })
        .catch(() => {
          setList((l) => l.map((e) => (e.author.address === address ? { ...e, following: false } : e)));
          toastError(t("common.tryAgain", { defaultValue: "Try again" }));
        });
    });

  const toggleLike = () =>
    requireAuth(() => {
      const next = !isLiked;
      if (next) {
        const id = Date.now();
        setBursts((b) => [...b, id]);
        setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 2600);
      }
      setLiked((m) => ({ ...m, [item.id]: next }));
      likeStory(item.id, next).catch(() => setLiked((m) => ({ ...m, [item.id]: !next })));
    });

  const sendReply = async () => {
    const text = reply.trim();
    if (!item.allowReplies || own || !me || !text || sendingReply.current) return;
    sendingReply.current = true;
    setSending(true);
    const input = replyInput.current;
    try {
      const outcome = await sendStoryReply(item.id, text, t("stories.repliedTo", { defaultValue: "Replied to your moment" }), me, ws);
      if (outcome === "paid-chat") {
        toastError(t("stories.paidChat", { defaultValue: "This person charges for messages. Open the chat to send it." }));
      } else {
        toastSuccess(t("stories.replySent", { defaultValue: "Reply sent" }));
        if (replyInput.current === input) {
          setReply("");
          input?.blur();
        }
      }
    } catch (error) {
      toastError(error instanceof Error ? error.message : t("stories.replyFailed", { defaultValue: "Couldn't send your reply." }));
    } finally {
      sendingReply.current = false;
      setSending(false);
    }
  };

  const remove = async () => {
    try {
      await deleteStory(item.id);
      void queryClient.invalidateQueries({ queryKey: ["moment-archive", me] });
      toastSuccess(t("stories.deleted", { defaultValue: "Moment deleted" }));
      setSheet(null);
      const rest = entry.items.filter((x) => x.id !== item.id);
      if (!rest.length) return onClose();
      setList((l) => l.map((e, i) => (i === authorIdx ? { ...e, items: rest } : e)));
      setItemIdx((i) => Math.min(i, rest.length - 1));
    } catch {
      toastError(t("stories.deleteFailed", { defaultValue: "Couldn't delete it. Try again." }));
    }
  };

  // The picture fills the screen edge to edge like the live player (and web)
  // when that crops only a little; otherwise the whole moment stays in view,
  // so text and stickers near the sides are never cut on tall phones.
  const ratio = item.width && item.height ? item.width / item.height : 9 / 16;
  const screenRatio = viewport.width && viewport.height ? viewport.width / viewport.height : ratio;
  const fit = ratio <= 1 && Math.abs(ratio - screenRatio) / screenRatio <= 0.1 ? "cover" : "contain";
  // Mentions follow the same 9:16 crop as the picture.
  const mentionFrameWidth = fit === "contain"
    ? Math.min(viewport.width, viewport.height * 9 / 16)
    : Math.max(viewport.width, viewport.height * 9 / 16);
  const mentionFrameHeight = mentionFrameWidth * 16 / 9;

  return (
    <DarkRoomProvider>
      <View className="dark-surface" style={styles.root} {...pan.panHandlers}>
        <View style={styles.mediaFrame} onLayout={({ nativeEvent: { layout: { width, height } } }) => {
          setViewport((previous) => previous.width === width && previous.height === height ? previous : { width, height });
        }}>
          {item.type === "video" && videoUri ? (
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} surfaceType="textureView" />
          ) : (
            <Image
              key={item.id}
              source={{ uri: item.mediaUrl || item.posterUrl || undefined }}
              style={StyleSheet.absoluteFill}
              contentFit={fit}
              onLoad={() => setLoadedId(item.id)}
              onError={() => setLoadedId(item.id)}
            />
          )}
          {item.overlayUrl ? <Image source={{ uri: item.overlayUrl }} style={StyleSheet.absoluteFill} contentFit={fit} pointerEvents="none" /> : null}
          <LinearGradient colors={["rgba(0,0,0,0.7)", "rgba(0,0,0,0)"]} style={[styles.topShade, { height: insets.top + 128 }]} pointerEvents="none" />
          <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.35)", "rgba(0,0,0,0.72)"]} style={styles.bottomShade} pointerEvents="none" />
          {!loaded ? (
            <View style={styles.center} pointerEvents="none">
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}

          {/* Tap zones: left third back, the rest forward; hold anywhere pauses. */}
          <View style={styles.zones} pointerEvents={sheet || openingOriginal ? "none" : "auto"}>
            <Pressable style={{ width: width / 3 }} onPress={() => goItem(-1)} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} />
            {item.postTokenId != null ? (
              <Pressable
                style={{ width: width / 3 }}
                onPress={() => { const id = item.id; setPostPeekId((prev) => (prev === id ? null : id)); }}
                onLongPress={() => setHeld(true)}
                onPressOut={() => setHeld(false)}
                delayLongPress={180}
                accessibilityRole="button"
                accessibilityLabel={t("stories.goToPost", { defaultValue: "Go to post" })}
              />
            ) : null}
            <Pressable style={{ flex: 1 }} onPress={() => goItem(1)} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} />
          </View>

          {!sheet && !openingOriginal && item.mentions.length > 0 && mentionFrameWidth > 0 ? (
            <View pointerEvents="box-none" style={{
              position: "absolute",
              left: (viewport.width - mentionFrameWidth) / 2,
              top: (viewport.height - mentionFrameHeight) / 2,
              width: mentionFrameWidth,
              height: mentionFrameHeight,
            }}>
              {item.mentions.map((m) => (
                <Pressable
                  key={`${m.address}-${m.x}`}
                  accessibilityRole="link"
                  accessibilityLabel={t("upload.studio.mention", { defaultValue: "Mention" })}
                  onPress={() => onOpenProfile(m.address)}
                  style={{ position: "absolute", left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
                />
              ))}
            </View>
          ) : null}
        </View>

        {/* One thin bar per moment, the current one filling as it plays (as on web). */}
        <View style={[styles.timing, { top: insets.top + 5 }]} pointerEvents="none">
          {entry.items.map((x, i) => (
            <View key={x.id} style={[styles.timingBar, i < itemIdx && styles.timingPlayed]}>
              {i === itemIdx ? <View style={[styles.timingFill, { width: `${Math.min(100, Math.round(progress * 100))}%` }]} /> : null}
            </View>
          ))}
        </View>

        {/* Who posted it, straight on the picture like the live player: the
            face with Follow as a small glass +, name and age, then bare icons. */}
        <View style={[styles.head, { top: insets.top + 14 }]} pointerEvents="box-none">
          <View style={styles.faceSlot}>
            <Avatar uri={avatarOf(entry.author, 36)} size={36} radius={8} name={entry.author.username || entry.author.address} onPress={() => onOpenProfile(entry.author.address)} />
            {!own && !entry.following ? (
              <Pressable
                onPress={followAuthor}
                hitSlop={10}
                className="dark-surface"
                style={styles.followBadge}
                accessibilityRole="button"
                accessibilityLabel={t("follow.follow", { defaultValue: "Follow" })}
              >
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(255,255,255,0.32)", "rgba(255,255,255,0.06)", "rgba(255,255,255,0.16)"]}
                  locations={[0, 0.55, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <View pointerEvents="none" style={styles.followSheen} />
                <Icon name="Plus" size={12} color="#fff" />
              </Pressable>
            ) : null}
          </View>
          <Pressable style={styles.who} accessibilityRole="link" accessibilityLabel={nameOf(entry.author)} onPress={() => onOpenProfile(entry.author.address)}>
            <Text style={styles.whoName} numberOfLines={1}>
              {own ? t("stories.yourDay", { defaultValue: "Your day" }) : nameOf(entry.author)}
            </Text>
            <Text style={styles.whoSub} numberOfLines={1}>
              {Date.now() - new Date(item.createdAt).getTime() < 60_000
                ? ageLabel(item.createdAt)
                : t("stories.agoLabel", { time: ageLabel(item.createdAt), defaultValue: "{{time}} ago" })}
              {item.audience === "followers" ? ` · ${t("stories.followersOnly", { defaultValue: "Followers" })}` : ""}
              {item.closeFriends || item.audience === "close_friends" ? (
                <Text style={{ color: "#4ade80", fontWeight: "700" }}>{` · ★ ${t("stories.closeFriends", { defaultValue: "Close friends" })}`}</Text>
              ) : null}
            </Text>
          </Pressable>
          {(item.type === "video" && !item.muted) || item.song ? (
            <Pressable onPress={() => setMuted((m) => !m)} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={muted ? t("common.unmute", { defaultValue: "Unmute" }) : t("common.mute", { defaultValue: "Mute" })}>
              <ShadowedIcon name={muted ? "VolumeX" : "Volume2"} size={19} />
            </Pressable>
          ) : null}
          <Pressable onPress={() => setSheet("more")} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t("stories.moreActions", { defaultValue: "Moment options" })} accessibilityState={{ expanded: sheet === "more" }}>
            <ShadowedIcon name="EllipsisVertical" size={20} />
          </Pressable>
          <Pressable onPress={onClose} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
            <ShadowedIcon name="X" size={21} />
          </Pressable>
        </View>

        {/* Status on one line, text on the picture like the live pills. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.status, { top: insets.top + 66 }]}
          contentContainerStyle={styles.statusRow}
        >
          <View style={styles.pill}>
            <View style={[styles.tag, { backgroundColor: accent }]}>
              <Text style={styles.tagText}>{t("stories.momentTag", { defaultValue: "MOMENT" })}</Text>
            </View>
            <Text style={styles.pillText}>{timeLeftLabel(item.expiresAt, t)}</Text>
          </View>
          {own ? (
            <Pressable style={styles.pill} onPress={() => setSheet("viewers")} accessibilityRole="button" accessibilityLabel={t("stories.whoWatched", { defaultValue: "Who watched" })}>
              <ShadowedIcon name="Eye" size={14} />
              <Text style={styles.pillText}>{viewsLabel}</Text>
              {(item.likeCount ?? 0) > 0 ? (
                <>
                  <MomentHeart size={12} filled />
                  <Text style={styles.pillText}>{formatCount(item.likeCount ?? 0)}</Text>
                </>
              ) : null}
            </Pressable>
          ) : null}
          {item.song ? (
            <View style={[styles.pill, { maxWidth: 220 }]}>
              {item.song.artworkUrl ? <Image source={{ uri: item.song.artworkUrl }} style={styles.songArt} /> : <ShadowedIcon name="Music" size={13} />}
              <Text style={[styles.pillText, { flexShrink: 1 }]} numberOfLines={1}>
                {item.song.title}
                {item.song.artist ? ` · ${item.song.artist}` : ""}
              </Text>
            </View>
          ) : null}
          {entry.items.length > 1 ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{t("stories.nOfM", { n: itemIdx + 1, m: entry.items.length, defaultValue: "{{n}} of {{m}}" })}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Bottom: comments floating like live chat, then the say-something row. */}
        {/* The keyboard view sets its own bottom padding on iPhone, so the safe-area gap lives on an inner view. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.bottom, sheet ? styles.hidden : undefined]}
          pointerEvents={sheet ? "none" : "box-none"}
          accessibilityElementsHidden={!!sheet}
          importantForAccessibility={sheet ? "no-hide-descendants" : "auto"}
        >
          <View style={[styles.bottomInner, { paddingBottom: typing ? 10 : insets.bottom + 20 }]} pointerEvents="box-none">
          {item.caption || item.remixSourceId || postPeek ? (
            <View style={styles.captionWrap} pointerEvents="box-none">
              {item.remixSourceId ? (
                <TouchableOpacity style={[styles.original, styles.darkGlass]} onPress={() => void openOriginal()} disabled={openingOriginal} accessibilityRole="button">
                  <Icon name="Repeat2" size={16} color="#fff" />
                  <Text style={styles.originalText} numberOfLines={1}>{t("stories.watchOriginal", { defaultValue: "Watch original moment" })}</Text>
                </TouchableOpacity>
              ) : null}
              {postPeek ? (
                <TouchableOpacity
                  style={[styles.original, styles.darkGlass]}
                  onPress={() => {
                    const tokenId = String(item.postTokenId);
                    onClose();
                    navigation.navigate(ScreenNames.PostResolver as never, { tokenId } as never);
                  }}
                  accessibilityRole="link"
                >
                  <Text style={styles.originalText} numberOfLines={1}>
                    {t("stories.goToPost", { defaultValue: "Go to post" })}
                    {item.postAuthorName ? <Text style={styles.postAuthor}>{`  @${item.postAuthorName}`}</Text> : null}
                  </Text>
                  <Icon name="ArrowUpRight" size={16} color="#fff" />
                </TouchableOpacity>
              ) : null}
              {item.caption ? (
                <MomentCaption key={item.id} text={item.caption} publicContent={item.shareable === true} />
              ) : null}
            </View>
          ) : null}
          {!typing && roomComments.length > 0 ? (
            <StoryRoomChat comments={roomComments} onOpen={() => setSheet("comments")} />
          ) : null}
          <View style={styles.replyRow}>
            {own ? (
              <TouchableOpacity style={styles.field} onPress={() => setSheet("viewers")} accessibilityRole="button" accessibilityLabel={t("stories.whoWatched", { defaultValue: "Who watched" })}>
                <ChromeFill glass radius={12} />
                <Icon name="Eye" size={18} color="#fff" />
                <Text style={styles.statText}>{viewsLabel}</Text>
                {(item.likeCount ?? 0) > 0 ? (
                  <>
                    <MomentHeart size={15} filled />
                    <Text style={styles.statText}>{formatCount(item.likeCount ?? 0)}</Text>
                  </>
                ) : null}
              </TouchableOpacity>
            ) : !me ? (
              <TouchableOpacity style={styles.field} onPress={() => requireAuth(() => {})}>
                <ChromeFill glass radius={12} />
                <Text style={styles.replyPlaceholder}>{t("stories.signInToReply", { defaultValue: "Sign in to reply" })}</Text>
              </TouchableOpacity>
            ) : item.allowReplies ? (
              <View style={[styles.field, typing && styles.replyFocused]}>
                <ChromeFill glass radius={12} />
                <TextInput
                  key={item.id}
                  ref={replyInput}
                  value={reply}
                  editable={!sending}
                  onChangeText={setReply}
                  onFocus={() => setTyping(true)}
                  onBlur={() => setTyping(false)}
                  placeholder={t("stories.privateReply", { defaultValue: "Send a private reply…" })}
                  accessibilityLabel={t("stories.sendPrivateReply", { defaultValue: "Send a private reply" })}
                  placeholderTextColor="rgba(255,255,255,0.7)"
                  style={styles.replyInput}
                  keyboardAppearance="dark"
                  returnKeyType="send"
                  submitBehavior="submit"
                  onSubmitEditing={() => void sendReply()}
                  maxLength={500}
                />
              </View>
            ) : (
              <View style={styles.field}>
                <ChromeFill glass radius={12} />
                <Text style={styles.repliesOff} numberOfLines={1}>{t("stories.repliesOff", { defaultValue: "Replies are off" })}</Text>
              </View>
            )}
            {!own ? (
              <Pressable onPress={toggleLike} style={styles.key} accessibilityRole="button" accessibilityLabel={t("stories.like", { defaultValue: "Like" })} accessibilityState={{ selected: isLiked }}>
                <ChromeFill glass radius={12} />
                <MomentHeart size={22} filled={isLiked} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => setSheet("comments")} style={styles.key} accessibilityRole="button" accessibilityLabel={t("stories.comments", { defaultValue: "Comments" })}>
              <ChromeFill glass radius={12} />
              <MomentComment size={22} />
              {(item.commentCount ?? 0) > 0 ? (
                <View style={styles.countBadge} pointerEvents="none">
                  <Text style={styles.countText}>{formatCount(item.commentCount ?? 0)}</Text>
                </View>
              ) : null}
            </Pressable>
            {!own && me && item.allowReplies && (typing || reply || sending) ? (
              <Pressable
                onPress={() => void sendReply()}
                disabled={sending || !reply.trim()}
                style={({ pressed }) => [
                  styles.key,
                  sending ? styles.sendPending : !reply.trim() ? styles.sendDisabled : pressed && styles.sendPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t("stories.sendPrivateReply", { defaultValue: "Send a private reply" })}
                accessibilityState={{ disabled: sending || !reply.trim(), busy: sending }}
              >
                <View pointerEvents="none" style={[styles.sendFill, { backgroundColor: accent }]} />
                <View pointerEvents="none">{sending ? <ActivityIndicator color="#0b0b0c" /> : <Icon name="Send" size={20} color="#0b0b0c" />}</View>
              </Pressable>
            ) : shareable ? (
              <Pressable onPress={() => setSheet("share")} style={styles.key} accessibilityRole="button" accessibilityLabel={t("stories.share", { defaultValue: "Share" })}>
                <ChromeFill glass radius={12} />
                <MomentShare size={22} />
              </Pressable>
            ) : null}
          </View>
          </View>
          <FloatHearts bursts={bursts} right={own ? 12 : 116} bottom={insets.bottom + 64} />
        </KeyboardAvoidingView>

        {sheet === "share-dm" && (
          <ShareToDmSheet visible url={momentUrl} onClose={() => setSheet("share")} />
        )}
        {sheet === "comments" && (
          <StoryComments
            key={item.id}
            item={item}
            signedIn={!!me}
            bottom={insets.bottom}
            onClose={() => setSheet(null)}
            onOpenProfile={onOpenProfile}
            onSignIn={() => { setSheet(null); requireAuth(() => {}); }}
            onCount={(n) => setList((l) => l.map((e, i) => (i === authorIdx ? { ...e, items: e.items.map((it) => (it.id === item.id ? { ...it, commentCount: n } : it)) } : e)))}
          />
        )}
        {sheet && sheet !== "share-dm" && sheet !== "comments" ? (
          <ViewerSheet
            kind={sheet}
            audience={audience}
            viewsLabel={viewsLabel}
            own={own}
            onClose={() => setSheet(null)}
            onPick={setSheet}
            onDelete={remove}
            onRemix={shareable ? remix : undefined}
            onCopyLink={shareable ? copyLink : undefined}
            onShareOutside={shareable ? shareOutside : undefined}
            onShareToDm={shareable && me ? () => setSheet("share-dm") : undefined}
            authorAddress={entry.author.address}
            onViewProfile={onOpenProfile}
            onMute={me ? () => {
              setSheet(null);
              const address = entry.author.address;
              void muteUser(address)
                .then((r: any) => {
                  if (r && r.status === false) throw new Error("mute failed");
                  void queryClient.invalidateQueries({ queryKey: ["story-shelf"] });
                  toastSuccess(t("stories.mutedToast", { defaultValue: "Muted. You won't see their Moments or posts." }));
                  goAuthor(1);
                })
                .catch(() => toastError(t("common.tryAgain", { defaultValue: "Try again" })));
            } : undefined}
            onUnfollow={me && entry.following ? () => {
              setSheet(null);
              const address = entry.author.address;
              void unfollowUser(me, address)
                .then(() => {
                  setList((l) => l.map((e) => (e.author.address === address ? { ...e, following: false } : e)));
                  void queryClient.invalidateQueries({ queryKey: ["story-shelf"] });
                  toastSuccess(t("stories.unfollowedToast", { defaultValue: "Unfollowed" }));
                })
                .catch(() => toastError(t("common.tryAgain", { defaultValue: "Try again" })));
            } : undefined}
            onReport={(reason) => {
              setSheet(null);
              if (!me) onClose();
              requireAuth(() => {
                void reportStory(item.id, reason)
                  .then(() => toastSuccess(t("stories.reported", { defaultValue: "Thanks. We'll take a look." })))
                  .catch(() => toastError(t("stories.reportFailed", { defaultValue: "Couldn't send the report." })));
              });
            }}
            bottom={insets.bottom}
          />
        ) : null}
      </View>
    </DarkRoomProvider>
  );
}

const REPORT_REASONS = [
  { key: "spam", reason: "spam_misleading", label: "Spam" },
  { key: "nudity", reason: "sexual_content", label: "Nudity or sexual content" },
  { key: "harassment", reason: "harassment_bullying", label: "Bullying or harassment" },
  { key: "violence", reason: "violent_content", label: "Violence or dangerous acts" },
  { key: "hate", reason: "hateful_content", label: "Hate speech" },
  { key: "other", reason: "other", label: "Something else" },
];

function ViewerSheet({
  kind,
  audience,
  viewsLabel,
  own,
  onClose,
  onPick,
  onDelete,
  onRemix,
  onCopyLink,
  onShareOutside,
  onShareToDm,
  onViewProfile,
  onMute,
  onUnfollow,
  authorAddress,
  onReport,
  bottom,
}: {
  kind: Exclude<Sheet, null | "share-dm">;
  audience: UseInfiniteQueryResult<InfiniteData<Awaited<ReturnType<typeof getStoryViewers>>>>;
  viewsLabel: string;
  own: boolean;
  onClose: () => void;
  onPick: (s: Sheet) => void;
  onDelete: () => void;
  onRemix?: () => void;
  onCopyLink?: () => void;
  onShareOutside?: () => void;
  onShareToDm?: () => void;
  authorAddress: string;
  onViewProfile: (address: string) => void;
  onMute?: () => void;
  onUnfollow?: () => void;
  onReport: (reason: string) => void;
  bottom: number;
}) {
  const { t } = useTranslation();
  const viewers = audience.data?.pages.flatMap(page => page.viewers) ?? [];

  return (
    <View style={styles.sheetBack}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
      <View style={[styles.sheet, { paddingBottom: bottom + 16 }]} accessibilityViewIsModal>
        {kind === "share" ? (
          <>
            {onShareToDm && <SheetRow icon="Send" label={t("feedCard.sendInMessage")} onPress={onShareToDm} />}
            {onCopyLink && <SheetRow icon="Link2" label={t("postOptions.copyLink", { defaultValue: "Copy link" })} onPress={onCopyLink} />}
            {onShareOutside && <SheetRow icon="Share2" label={t("stories.share", { defaultValue: "Share" })} onPress={onShareOutside} />}
            {onRemix && <SheetRow icon="Repeat2" label={t("stories.addToMoment", { defaultValue: "Add to your Moment" })} onPress={onRemix} />}
            <SheetRow icon="X" label={t("common.cancel", { defaultValue: "Cancel" })} onPress={onClose} />
          </>
        ) : null}
        {kind === "more" ? (
          <>
            {onRemix ? <SheetRow icon="Repeat2" label={t("remix.title", { defaultValue: "Remix" })} onPress={onRemix} /> : null}
            {onCopyLink ? <SheetRow icon="Link2" label={t("postOptions.copyLink", { defaultValue: "Copy link" })} onPress={onCopyLink} /> : null}
            {own ? (
              <>
                <SheetRow icon="Eye" label={t("stories.whoWatched", { defaultValue: "Who watched" })} onPress={() => onPick("viewers")} />
                <SheetRow icon="Trash2" label={t("stories.delete", { defaultValue: "Delete moment" })} danger onPress={() => onPick("delete")} />
              </>
            ) : (
              <>
                <SheetRow icon="User" label={t("stories.viewProfile", { defaultValue: "View profile" })} onPress={() => onViewProfile(authorAddress)} />
                {onUnfollow ? <SheetRow icon="UserMinus" label={t("stories.unfollow", { defaultValue: "Unfollow" })} onPress={onUnfollow} /> : null}
                {onMute ? <SheetRow icon="VolumeX" label={t("stories.muteAccount", { defaultValue: "Mute" })} onPress={onMute} /> : null}
                <SheetRow icon="Flag" label={t("stories.report", { defaultValue: "Report" })} danger onPress={() => onPick("report")} />
              </>
            )}
            <SheetRow icon="X" label={t("common.cancel", { defaultValue: "Cancel" })} onPress={onClose} />
          </>
        ) : null}
        {kind === "delete" ? (
          <>
            <Text style={styles.sheetTitle}>{t("stories.deleteConfirm", { defaultValue: "Delete this moment?" })}</Text>
            <SheetRow icon="Trash2" label={t("common.delete", { defaultValue: "Delete" })} danger onPress={onDelete} />
            <SheetRow icon="X" label={t("common.cancel", { defaultValue: "Cancel" })} onPress={onClose} />
          </>
        ) : null}
        {kind === "report" ? (
          <>
            <Text style={styles.sheetTitle}>{t("stories.reportWhy", { defaultValue: "Why are you reporting this?" })}</Text>
            {REPORT_REASONS.map((r) => (
              <SheetRow key={r.key} label={t(`stories.reason.${r.key}`, { defaultValue: r.label })} onPress={() => onReport(r.reason)} />
            ))}
          </>
        ) : null}
        {kind === "viewers" && own ? (
          <>
            <Text style={styles.sheetTitle} accessibilityRole="header" accessibilityLiveRegion="polite">{viewsLabel}</Text>
            {audience.isPending ? (
              <ActivityIndicator color="#fff" style={{ marginVertical: 20 }} accessibilityLabel={t("common.loading", { defaultValue: "Loading" })} />
            ) : !audience.data ? (
              <SheetRow label={t("common.tryAgain", { defaultValue: "Try again" })} onPress={() => void audience.refetch()} disabled={audience.isFetching} />
            ) : viewers.length === 0 && !audience.hasNextPage ? (
              <Text style={styles.empty}>{t("stories.noViewsYet", { defaultValue: "No one has watched yet." })}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {viewers.map((v) => (
                  <TouchableOpacity key={v.address} style={styles.viewerRow} accessibilityRole="link" accessibilityLabel={nameOf(v)} onPress={() => onViewProfile(v.address)}>
                    <Avatar uri={avatarOf(v, 36)} size={34} radius={17} name={v.username || v.address} />
                    <Text style={styles.viewerName} numberOfLines={1}>
                      {nameOf(v)}
                    </Text>
                    {v.liked ? <Icon name="Heart" size={16} color="#FF5C78" fill="#FF5C78" /> : null}
                  </TouchableOpacity>
                ))}
                {audience.hasNextPage ? (
                  <SheetRow
                    label={t("common.loadMore", { defaultValue: "Load more" })}
                    onPress={() => void audience.fetchNextPage({ cancelRefetch: false })}
                    disabled={audience.isFetching}
                    loading={audience.isFetchingNextPage}
                  />
                ) : null}
              </ScrollView>
            )}
          </>
        ) : null}
      </View>
    </View>
  );
}

function SheetRow({ icon, label, onPress, danger, disabled, loading }: { icon?: React.ComponentProps<typeof Icon>["name"]; label: string; onPress: () => void; danger?: boolean; disabled?: boolean; loading?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.sheetRow, disabled && styles.sheetRowDisabled]} accessibilityRole="button" accessibilityState={{ disabled, busy: loading }}>
      {icon ? <Icon name={icon} size={18} color={danger ? "#FF5C78" : "#fff"} /> : null}
      <Text style={[styles.sheetRowText, danger && { color: "#FF5C78" }]}>{label}</Text>
      {loading ? <ActivityIndicator color="#fff" size="small" /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  mediaFrame: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  topShade: { position: "absolute", top: 0, left: 0, right: 0, height: 140 },
  bottomShade: { position: "absolute", bottom: 0, left: 0, right: 0, height: 300 },
  zones: { ...StyleSheet.absoluteFillObject, flexDirection: "row" },
  /** Web's dark glass over a photo: see-through dark, thin light rim. */
  darkGlass: {
    backgroundColor: "rgba(20,20,24,0.5)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
  },
  timing: { position: "absolute", left: 16, right: 16, height: 3, flexDirection: "row", gap: 3 },
  timingBar: {
    flex: 1,
    minWidth: 0,
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  timingPlayed: { backgroundColor: "#fff" },
  timingFill: { height: 3, backgroundColor: "#fff" },
  hidden: { opacity: 0 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bottomInner: { paddingHorizontal: 12, paddingTop: 8 },
  head: { position: "absolute", left: 0, right: 0, minHeight: 48, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 4 },
  faceSlot: { marginRight: 6 },
  followBadge: {
    position: "absolute",
    right: -6,
    bottom: -6,
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#27272A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
  },
  followSheen: { position: "absolute", top: 0, left: 2, right: 2, height: 1, backgroundColor: "rgba(255,255,255,0.6)" },
  who: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  whoName: { color: "#fff", fontSize: 14, fontWeight: "800", ...TEXT_SHADOW },
  whoSub: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "600", marginTop: 1, ...TEXT_SHADOW },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  status: { position: "absolute", left: 0, right: 0, height: 28, flexGrow: 0 },
  statusRow: { paddingHorizontal: 8, gap: 8, alignItems: "center" },
  pill: { height: 28, paddingHorizontal: 4, flexDirection: "row", alignItems: "center", gap: 6 },
  pillText: { color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "600", ...TEXT_SHADOW },
  tag: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  tagText: { color: "#0b0b0c", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.6 },
  field: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: CHROME_HAIRLINE,
  },
  key: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  sendDisabled: { opacity: 0.45 },
  sendPending: { opacity: 0.85 },
  sendPressed: { transform: [{ scale: 0.97 }] },
  sendFill: { ...StyleSheet.absoluteFillObject, borderRadius: 11 },
  captionWrap: { marginRight: 60, marginBottom: 10, alignItems: "flex-start" },
  original: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 18, marginBottom: 6 },
  postAuthor: { opacity: 0.75, fontWeight: "500" },
  originalText: { color: "#fff", fontSize: 14 },
  songArt: { width: 16, height: 16, borderRadius: 4 },
  repliesOff: { flex: 1, color: "rgba(255,255,255,0.6)", fontSize: 13 },
  replyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  // Fills the field so the text and placeholder sit centred on iPhone too.
  replyInput: { flex: 1, alignSelf: "stretch", height: "100%", color: "#fff", fontSize: 15, paddingTop: 0, paddingBottom: 0, textAlignVertical: "center", includeFontPadding: false },
  replyFocused: { borderColor: "rgba(255,255,255,0.9)" },
  replyPlaceholder: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  countBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 6,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: "#0b0b0c", fontSize: 10.5, fontWeight: "800" },
  statText: { color: "#fff", fontSize: 14, fontWeight: "600", marginRight: 6 },
  sheetBack: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#16161A",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 14,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  sheetTitle: { color: "#fff", fontSize: 15, fontWeight: "700", paddingHorizontal: 8, paddingBottom: 8 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 8 },
  sheetRowText: { color: "#fff", fontSize: 15 },
  empty: { color: "rgba(255,255,255,0.65)", paddingHorizontal: 8, paddingVertical: 16 },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 8 },
  viewerName: { flex: 1, minWidth: 0, overflow: "hidden", color: "#fff", fontSize: 14 },
  sheetRowDisabled: { opacity: 0.65 },
});
