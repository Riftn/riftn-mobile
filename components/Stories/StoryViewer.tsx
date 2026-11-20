/**
 * Full-screen moments viewer. Port of web's `components/app/stories/StoryViewer`.
 *
 * Tap right/left for the next or last moment, hold to pause, swipe down to
 * close, swipe sideways for the next person. Photos run 5 s, videos their
 * length. Like and reply (a reply is a DM); owners see views and likes and who
 * watched, and can delete. Dark in every theme.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";

import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { DarkRoomProvider } from "../../context/ThemeContext";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import { useUser, useAuthActions } from "../../context/AuthContext";
import { ScreenNames } from "../../navigation/ScreenNames";
import { WEBSITE_LINK } from "../../config/links";
import { formatCount } from "../../libs/format-count";
import { toastError, toastSuccess } from "../../libs/toast";
import {
  checkStoryReply,
  deleteStory,
  getStoryViewers,
  likeStory,
  markStoryViewed,
  reportStory,
  type ShelfEntry,
  type StoryItem,
  type StoryViewer as Viewer,
} from "../../services/stories.service";
import { ageLabel, avatarOf, nameOf, startIndex } from "./story-utils";

const PHOTO_MS = 5000;
const TICK_MS = 50;

type Sheet = null | "more" | "viewers" | "report" | "delete";

export default function StoryViewer({
  entries,
  index: firstIndex,
  onClose,
}: {
  entries: ShelfEntry[];
  index: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const user = useUser();
  const { requireAuth } = useAuthActions();
  const { showUserProfile } = useUserProfileSheet();
  const me = (user?.walletAddress || user?.address || "").toLowerCase();

  const [list, setList] = useState(entries);
  const [authorIdx, setAuthorIdx] = useState(firstIndex);
  const [itemIdx, setItemIdx] = useState(() => (entries[firstIndex] ? startIndex(entries[firstIndex]) : 0));
  const entry = list[authorIdx];
  const item: StoryItem | undefined = entry?.items[itemIdx];
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
  const paused = held || typing || sheet !== null || !loaded;

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
  useEffect(() => {
    elapsed.current = 0;
    setProgress(0);
    setReply("");
  }, [authorIdx, itemIdx]);

  // Photo clock.
  const goItemRef = useRef(goItem);
  goItemRef.current = goItem;
  useEffect(() => {
    if (!item || item.type === "video" || paused) return;
    const id = setInterval(() => {
      elapsed.current += TICK_MS;
      const p = Math.min(1, elapsed.current / PHOTO_MS);
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
      player.addListener("playToEnd", () => goItemRef.current(1)),
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

  // ── Gestures: swipe down closes, sideways changes person ──
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 14 || Math.abs(g.dx) > 14,
        onPanResponderGrant: () => setHeld(true),
        onPanResponderRelease: (_e, g) => {
          setHeld(false);
          if (g.dy > 90 && Math.abs(g.dy) > Math.abs(g.dx)) onClose();
          else if (g.dx < -70 && Math.abs(g.dx) > Math.abs(g.dy)) goAuthor(1);
          else if (g.dx > 70 && Math.abs(g.dx) > Math.abs(g.dy)) goAuthor(-1);
        },
        onPanResponderTerminate: () => setHeld(false),
      }),
    [onClose, goAuthor],
  );

  if (!entry || !item) return null;
  const width = Dimensions.get("window").width;
  const isLiked = liked[item.id] ?? item.liked;

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
      const link = `${WEBSITE_LINK}/moment/${item.id}`;
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

  const fit = item.width && item.height && item.width > item.height ? "contain" : "cover";

  return (
    <DarkRoomProvider>
      <View className="dark-surface" style={styles.root} {...pan.panHandlers}>
        {item.type === "video" && videoUri ? (
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} />
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
        <View style={styles.zones}>
          <Pressable style={{ width: width / 3 }} onPress={() => goItem(-1)} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} />
          <Pressable style={{ flex: 1 }} onPress={() => goItem(1)} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} delayLongPress={180} />
        </View>

        {item.mentions.map((m) => (
          <Pressable
            key={`${m.address}-${m.x}`}
            onPress={() => {
              onClose();
              showUserProfile(m.address, { source: "moment" });
            }}
            style={{ position: "absolute", left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
          />
        ))}

        {/* Capsule: who, when, how far along, and the actions. */}
        <View style={[styles.cap, { top: insets.top + 8 }]}>
          <View style={[styles.capFill, { width: `${Math.round(progress * 100)}%` }]} pointerEvents="none" />
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
          <TouchableOpacity onPress={() => setSheet("more")} hitSlop={8} style={styles.capBtn} accessibilityLabel={t("common.more", { defaultValue: "More" })}>
            <Icon name="Ellipsis" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.capBtn} accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
            <Icon name="X" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Bottom: caption, then reply + like, or the owner's counts. */}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
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
              <TouchableOpacity style={styles.ownStats} onPress={() => setSheet("viewers")}>
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
          </View>
        </KeyboardAvoidingView>

        {sheet ? (
          <ViewerSheet
            kind={sheet}
            item={item}
            own={own}
            onClose={() => setSheet(null)}
            onPick={setSheet}
            onDelete={remove}
            onReport={(reason) => {
              reportStory(item.id, reason)
                .then(() => toastSuccess(t("stories.reported", { defaultValue: "Thanks. We'll take a look." })))
                .catch(() => toastError(t("stories.reportFailed", { defaultValue: "Couldn't send the report." })));
              setSheet(null);
            }}
            bottom={insets.bottom}
          />
        ) : null}
      </View>
    </DarkRoomProvider>
  );
}

const REPORT_REASONS: { key: string; label: string }[] = [
  { key: "spam", label: "Spam" },
  { key: "nudity", label: "Nudity or sexual content" },
  { key: "harassment", label: "Bullying or harassment" },
  { key: "violence", label: "Violence or dangerous acts" },
  { key: "hate", label: "Hate speech" },
  { key: "other", label: "Something else" },
];

function ViewerSheet({
  kind,
  item,
  own,
  onClose,
  onPick,
  onDelete,
  onReport,
  bottom,
}: {
  kind: Exclude<Sheet, null>;
  item: StoryItem;
  own: boolean;
  onClose: () => void;
  onPick: (s: Sheet) => void;
  onDelete: () => void;
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
    <Pressable style={styles.sheetBack} onPress={onClose}>
      <Pressable style={[styles.sheet, { paddingBottom: bottom + 16 }]} onPress={() => {}}>
        {kind === "more" ? (
          own ? (
            <>
              <SheetRow icon="Eye" label={t("stories.whoWatched", { defaultValue: "Who watched" })} onPress={() => onPick("viewers")} />
              <SheetRow icon="Trash2" label={t("stories.delete", { defaultValue: "Delete moment" })} danger onPress={() => onPick("delete")} />
            </>
          ) : (
            <SheetRow icon="Flag" label={t("stories.report", { defaultValue: "Report" })} onPress={() => onPick("report")} />
          )
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
              <SheetRow key={r.key} label={t(`stories.reason.${r.key}`, { defaultValue: r.label })} onPress={() => onReport(r.key)} />
            ))}
          </>
        ) : null}
        {kind === "viewers" ? (
          <>
            <Text style={styles.sheetTitle}>
              {t("stories.viewsCount", { defaultValue: "{{count}} views", count: item.viewCount ?? 0, formatted: formatCount(item.viewCount ?? 0) })}
            </Text>
            {viewers === null ? (
              <ActivityIndicator color="#fff" style={{ marginVertical: 20 }} />
            ) : viewers.length === 0 ? (
              <Text style={styles.empty}>{t("stories.noViewsYet", { defaultValue: "No one has watched yet." })}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {viewers.map((v) => (
                  <View key={v.address} style={styles.viewerRow}>
                    <Avatar uri={avatarOf(v, 36)} size={34} radius={17} name={v.username || v.address} />
                    <Text style={styles.viewerName} numberOfLines={1}>
                      {nameOf(v)}
                    </Text>
                    {v.liked ? <Icon name="Heart" size={16} color="#FF5C78" fill="#FF5C78" /> : null}
                  </View>
                ))}
              </ScrollView>
            )}
          </>
        ) : null}
      </Pressable>
    </Pressable>
  );
}

function SheetRow({ icon, label, onPress, danger }: { icon?: React.ComponentProps<typeof Icon>["name"]; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.sheetRow}>
      {icon ? <Icon name={icon} size={18} color={danger ? "#FF5C78" : "#fff"} /> : null}
      <Text style={[styles.sheetRowText, danger && { color: "#FF5C78" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** The viewer as a full-screen modal over whatever is open. */
export function StoryViewerModal({ entries, index, onClose }: { entries: ShelfEntry[]; index: number; onClose: () => void }) {
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <StoryViewer entries={entries} index={index} onClose={onClose} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
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
    backgroundColor: "rgba(20,20,24,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
  },
  capFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.14)" },
  capText: { flex: 1, minWidth: 0 },
  capName: { color: "#fff", fontSize: 14, fontWeight: "700" },
  capSub: { color: "rgba(255,255,255,0.72)", fontSize: 11.5, marginTop: 1 },
  capBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", gap: 4, marginRight: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotOn: { backgroundColor: "#fff" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 8 },
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
  sheetBack: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
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
  viewerName: { flex: 1, color: "#fff", fontSize: 14 },
});
