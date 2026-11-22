/**
 * Full-screen moments viewer. Port of web's `components/app/stories/StoryViewer`.
 *
 * Tap right/left for the next or last moment, hold to pause, swipe down to
 * close, swipe sideways for the next person. Photos follow the author’s timer, videos their
 * length. Like and reply (a reply is a DM); owners see views and likes and who
 * watched, and can delete. Dark in every theme.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";

import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import ShareToDmSheet from "../DM/ShareToDmSheet";
import { DarkRoomProvider } from "../../context/ThemeContext";
import { useUser, useAuthActions } from "../../context/AuthContext";
import { ScreenNames } from "../../navigation/ScreenNames";
import { WEBSITE_LINK } from "../../config/links";
import { formatCount } from "../../libs/format-count";
import { toastError, toastSuccess } from "../../libs/toast";
import {
  checkStoryReply,
  deleteStory,
  getStory,
  getStoryViewers,
  likeStory,
  markStoryViewed,
  reportStory,
  type ShelfEntry,
  type StoryItem,
  type StoryViewer as Viewer,
} from "../../services/stories.service";
import { openStoryCreator, openStoryViewer } from "../../store/stories.store";
import { ageLabel, avatarOf, nameOf, startIndex } from "./story-utils";

const DEFAULT_PHOTO_MS = 5000;
const TICK_MS = 50;

type Sheet = null | "more" | "viewers" | "report" | "delete" | "share" | "share-dm";

export default function StoryViewer({
  entries,
  index: firstIndex,
  onOpenProfile,
  onClose,
}: {
  entries: ShelfEntry[];
  index: number;
  onOpenProfile: (address: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const user = useUser();
  const { requireAuth } = useAuthActions();
  const me = (user?.walletAddress || user?.address || "").toLowerCase();

  const [list, setList] = useState(entries);
  const [authorIdx, setAuthorIdx] = useState(firstIndex);
  const [itemIdx, setItemIdx] = useState(() => (entries[firstIndex] ? startIndex(entries[firstIndex]) : 0));
  const entry = list[authorIdx];
  const snapshot: StoryItem | undefined = entry?.items[itemIdx];
  const customAudience = snapshot?.audience === 'selected' || snapshot?.audience === 'except';
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
    if (!customAudience) return snapshot;
    if (!snapshot || !me || !delivery.isSuccess) return undefined;
    const { mediaUrl, posterUrl, overlayUrl } = delivery.data.item;
    return { ...snapshot, mediaUrl, posterUrl, overlayUrl };
  }, [snapshot, customAudience, me, delivery.data, delivery.isSuccess]);
  useEffect(() => {
    if (customAudience && (!me || delivery.isError)) onClose();
  }, [customAudience, me, delivery.isError, onClose]);
  const own = !!entry && (entry.own || entry.author.address.toLowerCase() === me);

  const [progress, setProgress] = useState(0);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const loaded = !!item && loadedId === item.id;
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [muted, setMuted] = useState(false);
  const [reply, setReply] = useState("");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [openingOriginal, setOpeningOriginal] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const originalRequest = useRef<symbol | null>(null);
  const paused = held || typing || sheet !== null || openingOriginal || !loaded;
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

  const toggleLike = () =>
    requireAuth(() => {
      const next = !isLiked;
      setLiked((m) => ({ ...m, [item.id]: next }));
      likeStory(item.id, next).catch(() => setLiked((m) => ({ ...m, [item.id]: !next })));
    });

  const sendReply = async () => {
    const text = reply.trim();
    if (!text) return;
    try {
      const res = await checkStoryReply(item.id);
      const label = t("stories.repliedTo", { defaultValue: "Replied to your moment" });
      const link = `${WEBSITE_LINK}/moment/${item.id}?reply=1`;
      setReply("");
      onClose();
      navigation.navigate(ScreenNames.Chat as never, {
        targetAddress: res.to || entry.author.address,
        title: nameOf(entry.author),
        targetUser: { address: entry.author.address, username: entry.author.username, displayName: entry.author.displayName, avatarImageUrl: entry.author.avatarImageUrl },
        autoSendText: `${label}: ${text}\n${link}`,
      } as never);
    } catch (e: any) {
      toastError(e?.message || t("stories.replyFailed", { defaultValue: "Couldn't send your reply." }));
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

  const fit = item.type === "photo" || (item.width && item.height && item.width > item.height) ? "contain" : "cover";
  // Photo mentions are baked into the contained canvas. Video mentions follow the cover-fit overlay.
  const mentionFrameWidth = item.type === "photo"
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
          {item.overlayUrl ? <Image source={{ uri: item.overlayUrl }} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /> : null}
          <LinearGradient colors={["rgba(0,0,0,0.45)", "rgba(0,0,0,0)"]} style={styles.topShade} pointerEvents="none" />
          <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]} style={styles.bottomShade} pointerEvents="none" />
          {!loaded ? (
            <View style={styles.center} pointerEvents="none">
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}

          {/* Tap zones: left third back, the rest forward; hold anywhere pauses. */}
          <View style={styles.zones} pointerEvents={sheet || openingOriginal ? "none" : "auto"}>
            <Pressable style={{ width: width / 3 }} onPress={() => goItem(-1)} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} />
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

        {/* Capsule: who, when, how far along, and the actions. */}
        <View style={[styles.cap, { top: insets.top + 8 }]}>
          <View style={[styles.capFill, { width: `${Math.round(progress * 100)}%` }]} pointerEvents="none" />
          <TouchableOpacity style={styles.authorLink} accessibilityRole="link" accessibilityLabel={nameOf(entry.author)} onPress={() => onOpenProfile(entry.author.address)}>
            <Avatar uri={avatarOf(entry.author, 32)} size={30} radius={15} name={entry.author.username || entry.author.address} />
            <View style={styles.capText}>
              <Text style={styles.capName} numberOfLines={1}>
                {nameOf(entry.author)}
              </Text>
              <Text style={styles.capSub} numberOfLines={1}>
                {ageLabel(item.createdAt)}
                {item.audience === "followers" ? ` · ${t("stories.followersOnly", { defaultValue: "Followers" })}` : ""}
              </Text>
            </View>
          </TouchableOpacity>
          {entry.items.length > 1 ? (
            <View style={styles.dots}>
              {entry.items.map((x, i) => (
                <View key={x.id} style={[styles.dot, i === itemIdx && styles.dotOn]} />
              ))}
            </View>
          ) : null}
          {item.type === "video" || item.song ? (
            <TouchableOpacity onPress={() => setMuted((m) => !m)} hitSlop={8} style={styles.capBtn}>
              <Icon name={muted ? "VolumeX" : "Volume2"} size={18} color="#fff" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => setSheet("more")} hitSlop={4} style={styles.capBtn} accessibilityRole="button" accessibilityLabel={t("stories.moreActions", { defaultValue: "Moment options" })} accessibilityState={{ expanded: sheet === "more" }}>
            <Icon name="Ellipsis" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={4} style={styles.capBtn} accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
            <Icon name="X" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Bottom: caption, then reply + like, or the owner's counts. */}
        {/* The keyboard view sets its own bottom padding on iPhone, so the safe-area gap lives on an inner view. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={sheet ? styles.hidden : undefined}
          pointerEvents={sheet ? "none" : "auto"}
          accessibilityElementsHidden={!!sheet}
          importantForAccessibility={sheet ? "no-hide-descendants" : "auto"}
        >
          <View style={[styles.bottomInner, { paddingBottom: typing ? 10 : insets.bottom + 18 }]}>
          {item.remixSourceId ? (
            <TouchableOpacity style={styles.song} onPress={() => void openOriginal()} disabled={openingOriginal} accessibilityRole="button">
              <Icon name="Repeat2" size={14} color="#fff" />
              <Text style={styles.songText} numberOfLines={1}>{t("stories.watchOriginal", { defaultValue: "Watch original moment" })}</Text>
            </TouchableOpacity>
          ) : null}
          {item.caption ? (
            <Text style={styles.caption} numberOfLines={3}>
              {item.caption}
            </Text>
          ) : null}
          {item.song ? (
            <View style={styles.song}>
              <Icon name="Music" size={12} color="#fff" />
              <Text style={styles.songText} numberOfLines={1}>
                {item.song.title}
                {item.song.artist ? ` · ${item.song.artist}` : ""}
              </Text>
            </View>
          ) : null}
          <View style={styles.replyRow}>
            {own ? (
              <TouchableOpacity style={styles.ownStats} onPress={() => setSheet("viewers")} accessibilityRole="button" accessibilityLabel={t("stories.whoWatched", { defaultValue: "Who watched" })}>
                <Icon name="Eye" size={16} color="#fff" />
                <Text style={styles.statText}>{formatCount(item.viewCount ?? 0)}</Text>
                {(item.likeCount ?? 0) > 0 ? (
                  <>
                    <Icon name="Heart" size={15} color="#FF5C78" />
                    <Text style={styles.statText}>{formatCount(item.likeCount ?? 0)}</Text>
                  </>
                ) : null}
              </TouchableOpacity>
            ) : !me ? (
              <TouchableOpacity style={styles.replyBox} onPress={() => requireAuth(() => {})}>
                <Text style={styles.replyPlaceholder}>{t("stories.signInToReply", { defaultValue: "Sign in to reply" })}</Text>
              </TouchableOpacity>
            ) : item.allowReplies ? (
              <View style={styles.replyBox}>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  onFocus={() => setTyping(true)}
                  onBlur={() => setTyping(false)}
                  placeholder={t("stories.replyTo", { defaultValue: "Reply to {{name}}", name: nameOf(entry.author) })}
                  placeholderTextColor="rgba(255,255,255,0.7)"
                  style={styles.replyInput}
                  keyboardAppearance="dark"
                  returnKeyType="send"
                  onSubmitEditing={() => void sendReply()}
                  maxLength={500}
                />
                {reply.trim() ? (
                  <TouchableOpacity onPress={() => void sendReply()} hitSlop={8}>
                    <Icon name="Send" size={18} color="#fff" />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {!own ? (
              <TouchableOpacity onPress={toggleLike} style={styles.round} accessibilityLabel={t("stories.like", { defaultValue: "Like" })}>
                <Icon name="Heart" size={20} color={isLiked ? "#FF5C78" : "#fff"} fill={isLiked ? "#FF5C78" : undefined} />
              </TouchableOpacity>
            ) : null}
            {shareable && (
              <TouchableOpacity onPress={() => setSheet("share")} style={styles.round} accessibilityRole="button" accessibilityLabel={t("stories.share", { defaultValue: "Share" })}>
                <Icon name="Share2" size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
          </View>
        </KeyboardAvoidingView>

        {sheet === "share-dm" && (
          <ShareToDmSheet visible url={momentUrl} onClose={() => setSheet("share")} />
        )}
        {sheet && sheet !== "share-dm" ? (
          <ViewerSheet
            kind={sheet}
            item={item}
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
  item,
  own,
  onClose,
  onPick,
  onDelete,
  onRemix,
  onCopyLink,
  onShareOutside,
  onShareToDm,
  onViewProfile,
  authorAddress,
  onReport,
  bottom,
}: {
  kind: Exclude<Sheet, null | "share-dm">;
  item: StoryItem;
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
  onReport: (reason: string) => void;
  bottom: number;
}) {
  const { t } = useTranslation();
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  useEffect(() => {
    if (kind !== "viewers") return;
    getStoryViewers(item.id)
      .then((r) => setViewers(r.viewers))
      .catch(() => setViewers([]));
  }, [kind, item.id]);

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
        {kind === "viewers" ? (
          <>
            <Text style={styles.sheetTitle}>
              {t("stories.viewsCount", { defaultValue: "{{formatted}} views", formatted: formatCount(item.viewCount ?? 0) })}
            </Text>
            {viewers === null ? (
              <ActivityIndicator color="#fff" style={{ marginVertical: 20 }} />
            ) : viewers.length === 0 ? (
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
              </ScrollView>
            )}
          </>
        ) : null}
      </View>
    </View>
  );
}

function SheetRow({ icon, label, onPress, danger }: { icon?: React.ComponentProps<typeof Icon>["name"]; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.sheetRow} accessibilityRole="button">
      {icon ? <Icon name={icon} size={18} color={danger ? "#FF5C78" : "#fff"} /> : null}
      <Text style={[styles.sheetRowText, danger && { color: "#FF5C78" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  mediaFrame: { flex: 1, overflow: "hidden" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  topShade: { position: "absolute", top: 0, left: 0, right: 0, height: 140 },
  bottomShade: { position: "absolute", bottom: 0, left: 0, right: 0, height: 220 },
  zones: { ...StyleSheet.absoluteFillObject, flexDirection: "row" },
  cap: {
    position: "absolute",
    left: 10,
    right: 10,
    height: 50,
    borderRadius: 25,
    paddingLeft: 8,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
    backgroundColor: "#242427",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
  },
  capFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.14)" },
  authorLink: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  capText: { flex: 1, minWidth: 0 },
  capName: { color: "#fff", fontSize: 14, fontWeight: "700" },
  capSub: { color: "#fff", fontSize: 11.5, marginTop: 1 },
  capBtn: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", gap: 4, marginRight: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotOn: { backgroundColor: "#fff" },
  hidden: { opacity: 0 },
  bottomInner: { paddingHorizontal: 12, gap: 8 },
  caption: { color: "#fff", fontSize: 15, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6, paddingHorizontal: 4 },
  song: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  songText: { color: "#fff", fontSize: 12, maxWidth: 240 },
  replyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  replyBox: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(20,20,24,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  replyInput: { flex: 1, color: "#fff", fontSize: 15, paddingVertical: 0 },
  replyPlaceholder: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20,20,24,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  ownStats: {
    flex: 1,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: "rgba(20,20,24,0.55)",
    alignSelf: "flex-start",
  },
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
});
