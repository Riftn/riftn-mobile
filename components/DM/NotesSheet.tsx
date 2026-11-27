/**
 * Notes
 * =====
 * A note is a short line with an optional song, GIF or place that stays up for
 * 24 hours. It opens like Instagram Notes: the person's face big with the
 * white cloud above it, you write yours in the cloud, a heart likes it.
 * Same as web's components/app/chat/NotesRow.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAudioPlayer } from "expo-audio";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Rect } from "react-native-svg";
import Avatar from "../common/Avatar";
import SmartImage from "../common/SmartImage";
import GifPicker from "./GifPicker";
import SoundPickerSheet from "../Post/SoundPickerSheet";
import { useAppTheme } from "../../context/ThemeContext";
import { supabase } from "../../services/supabase";
import { withWalletHeader } from "../../libs/supabase-wallet-client";
import { getAvatarUrl } from "../../libs/misc";
import { playableSoundUrl, soundWindow } from "../../libs/soundWindow";
import { toastError, toastSuccess } from "../../libs/toast";
import type { AttachedSound } from "../../hooks/usePostSound";
import type { StoryAuthor, StorySong } from "../../services/stories.service";
import {
  deleteNote, getNotes, isNoteGif, likeNote, NOTE_LOCATION_MAX, NOTE_TEXT_MAX, putNote,
  type Note, type NoteEntry, type NoteInput,
} from "../../services/notes.service";
import { useNoteWords } from "./note-translate";
import { formatCount } from "../../libs/format-count";
import { useUser } from "../../context/AuthContext";
import { BoldText, stripBold } from "../../libs/bold-markup";
import { getActivityShelfPreferences, setActivityBarHidden, useActivityShelfPreferences } from "../../libs/activity-shelf-preferences";
import { ActivityShelfMenu, type ActivityTarget } from "../Stories/ActivityShelfMenu";

export const NOTES_QUERY_KEY = ["dm-notes"] as const;

const statusKey = (entry: NoteEntry) => `status:${entry.note.id}`;
const visibleNotes = (notes: NoteEntry[], dismissed: string[]) => notes.filter(entry => !dismissed.includes(statusKey(entry)));

function useVisibleNotes(enabled = true) {
  const { dismissed } = useActivityShelfPreferences();
  const { data } = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: getNotes, staleTime: 60_000, enabled });
  return React.useMemo(() => data ? { ...data, notes: visibleNotes(data.notes, dismissed) } : undefined, [data, dismissed]);
}

const nameOf = (a: StoryAuthor) => a.displayName || a.username || `${a.address.slice(0, 6)}…`;
/**
 * Note colours follow the theme: on System Light the ink goes dark and the
 * chip material goes to a faint ink wash, so nothing is white on white.
 * The light set is written as hsla() so System Light's colour pass
 * (libs/jsx/tone.js) leaves it alone instead of turning it back to white.
 */
function useNoteInk() {
  const { isLight } = useAppTheme();
  return isLight
    ? { ink: "hsla(240,8%,4%,1)", ink2: "hsla(240,8%,4%,0.62)", bubble: "hsla(0,0%,0%,0.06)", field: "hsla(0,0%,0%,0.05)", hairline: "hsla(0,0%,0%,0.08)", track: "hsla(0,0%,0%,0.14)", primaryBg: "hsla(240,8%,7%,1)", primaryInk: "hsla(0,0%,100%,1)", ring: "hsla(0,0%,100%,1)" }
    : { ink: "#fff", ink2: "hsla(240, 5%, 65%, 1)", bubble: "hsla(240, 5%, 96%, 0.12)", field: "hsla(240, 5%, 96%, 0.08)", hairline: "hsla(0, 0%, 100%, 0.10)", track: "hsla(0, 0%, 100%, 0.16)", primaryBg: "#fff", primaryInk: "#0b0b0c", ring: "#16161a" };
}

function songFrom(sound: AttachedSound): StorySong | null {
  const audioUrl = playableSoundUrl(sound.url);
  if (!/^https:\/\//.test(audioUrl)) return null;
  return {
    title: sound.title,
    artist: sound.creator,
    audioUrl,
    artworkUrl: sound.creatorAvatar && /^https:\/\//.test(sound.creatorAvatar) ? sound.creatorAvatar : undefined,
    startMs: Math.round((soundWindow(sound.url)?.start ?? 0) * 1000),
  };
}

function NoteBubble({ note, placeholder, own }: { note: Note | null; placeholder: string; own?: boolean }) {
  const c = useNoteInk();
  const words = useNoteWords(note?.text, own).shown;
  if (!note) {
    return (
      <View style={{ backgroundColor: c.field, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 84, flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Ionicons name="add" size={12} color={c.ink2} />
        <Text className="text-theme-neutrals-400 text-[11px]" numberOfLines={1}>{placeholder}</Text>
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: c.bubble, borderRadius: 10, borderWidth: 1, borderColor: c.hairline, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 84, alignItems: "center", gap: 2 }}>
      {!!note.gifUrl && <SmartImage source={{ uri: note.gifUrl }} style={{ width: 48, height: 32, borderRadius: 6 }} contentFit="cover" />}
      {!!note.text && <Text className="text-white text-[11px] text-center" numberOfLines={2}><BoldText text={words} /></Text>}
      {!note.text && !!note.song && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Ionicons name="musical-notes" size={11} color={c.ink} />
          <Text className="text-white text-[11px]" numberOfLines={1} style={{ maxWidth: 62 }}>{note.song.title}</Text>
        </View>
      )}
      {!note.text && !note.song && !!note.location && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Ionicons name="location" size={11} color={c.ink} />
          <Text className="text-white text-[11px]" numberOfLines={1} style={{ maxWidth: 62 }}>{note.location}</Text>
        </View>
      )}
    </View>
  );
}

/** Share of the 24 hours a note has left, 0..1. */
export function useNoteLeft(note: Note | null): number {
  const calc = () => {
    if (!note) return 0;
    const start = Date.parse(note.postedAt);
    const end = Date.parse(note.expiresAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
    return Math.min(1, Math.max(0, (end - Date.now()) / (end - start)));
  };
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    const id = setInterval(() => setLeft(calc()), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, note?.expiresAt]);
  return left;
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const FACE = 56;
const RING = 64;
const RING_STROKE = 2.5;
const RING_R = 14;

/**
 * Countdown ring around a note's face: a rounded-square line that drains as
 * the 24 hours run out. It sweeps in from empty when the row opens.
 */
export function NoteRing({ left, size = RING, radius = RING_R }: { left: number; size?: number; radius?: number }) {
  const c = useNoteInk();
  const side = size - RING_STROKE;
  const r = radius;
  const perimeter = 4 * (side - 2 * r) + 2 * Math.PI * r;
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(sweep, { toValue: left, duration: 700, useNativeDriver: false }).start();
  }, [left, sweep]);
  const offset = sweep.interpolate({ inputRange: [0, 1], outputRange: [perimeter, 0] });
  return (
    <Svg width={size} height={size} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
      <Rect x={RING_STROKE / 2} y={RING_STROKE / 2} width={side} height={side} rx={r} ry={r}
        fill="none" stroke={c.track} strokeWidth={RING_STROKE} />
      <AnimatedRect x={RING_STROKE / 2} y={RING_STROKE / 2} width={side} height={side} rx={r} ry={r}
        fill="none" stroke={c.ink} strokeWidth={RING_STROKE} strokeLinecap="round"
        strokeDasharray={`${perimeter} ${perimeter}`} strokeDashoffset={offset} />
    </Svg>
  );
}

/**
 * One note in the row. Every tile is the same size: a bubble slot on top
 * (empty when there are no words), the face inside its countdown ring, and
 * the name. A GIF note shows the GIF in place of the face.
 */
export function NoteTile({ author, note, label, onPress, placeholder, own }: { author: StoryAuthor; note: Note | null; label: string; onPress: () => void; placeholder: string; own?: boolean }) {
  const avatar = getAvatarUrl(author.avatarImageUrl, 56);
  const left = useNoteLeft(note);
  const gif = note?.gifUrl || null;
  const showBubble = !note || !!note.text || (!gif && (!!note.song || !!note.location));
  return (
    <Pressable onPress={onPress} style={{ width: 84, alignItems: "center", gap: 4, paddingTop: 2 }} accessibilityRole="button" accessibilityLabel={label}>
      <View style={{ height: 36, justifyContent: "flex-end", alignItems: "center" }}>
        {showBubble ? <NoteBubble own={own} note={note && gif ? { ...note, gifUrl: null } : note} placeholder={placeholder} /> : null}
      </View>
      <View style={{ width: RING, height: RING, alignItems: "center", justifyContent: "center" }}>
        {gif
          ? <SmartImage source={{ uri: gif }} style={{ width: FACE, height: FACE, borderRadius: 12 }} contentFit="cover" />
          : <Avatar uri={avatar && avatar !== "default-avatar" ? avatar : undefined} size={FACE} radius={12} name={nameOf(author)} />}
        {note ? <NoteRing left={left} /> : null}
      </View>
      <Text className="text-theme-neutrals-400 text-[11px]" numberOfLines={1} style={{ maxWidth: 80 }}>{label}</Text>
    </Pressable>
  );
}

// ── The status screen ────────────────────────────────────────────────────
// A status opens like a Moment: full screen, the words big in the middle on a
// blurred copy of the person's photo (or the colour they picked), bars on top,
// a reply box and a heart at the bottom. Tap the sides or swipe to go through
// everyone's; press and hold to pause; swipe down to close.
// Same as web's NotesRow (NoteStage / MyNoteStage / NoteWriter).
// The whole screen is a `dark-surface`, so System Light leaves it white on dark.

/** How long one status stays before the next one comes up. */
const NOTE_PAGE_MS = 7000;
const WHITE = "#fff";
const WHITE_DIM = "rgba(255,255,255,0.72)";
const INK = "#0b0b0c";
/** Phone web draws a focus box round inputs. */
const NO_OUTLINE = (Platform.OS === "web" ? { outlineStyle: "none", outlineWidth: 0 } : null) as any;
const WORD_SHADOW = { textShadowColor: "rgba(0,0,0,0.35)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 14 } as const;
const GLASS = { backgroundColor: "rgba(0,0,0,0.22)", borderWidth: 1, borderColor: "rgba(255,255,255,0.26)" } as const;

/** Room for the status bar and home bar; the backdrop runs under both. */
function useStagePad() {
  const insets = useSafeAreaInsets();
  return { flex: 1, paddingHorizontal: 14, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 } as const;
}

/** Colours a status can sit on, besides the person's own photo. */
const BACKDROPS: Record<string, [string, string, string]> = {
  violet: ["#a194ff", "#6c52f0", "#3a289c"],
  pink: ["#ff90c2", "#f0477f", "#981e4b"],
  ink: ["#2a2a31", "#141417", "#0b0b0c"],
  mint: ["#94e6d2", "#5fb0e6", "#3a6cb5"],
};
const BACKDROP_KEYS = ["photo", "violet", "pink", "ink", "mint"] as const;

/** "2h", "35m": short, like the chat list. */
function shortSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "1m";
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

/** Bigger words for a short line, smaller for a long one. */
const wordSize = (text: string) => (text.length <= 18 ? 34 : text.length <= 36 ? 29 : 25);

function Backdrop({ author, background }: { author: StoryAuthor; background?: string | null }) {
  const preset = background ? BACKDROPS[background] : undefined;
  const avatar = getAvatarUrl(author.avatarImageUrl, 200);
  const photo = !preset && avatar && avatar !== "default-avatar" ? avatar : null;
  return (
    <View pointerEvents="none" testID={`note-backdrop-${preset ? background : "photo"}`} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden", backgroundColor: "#1a171d" }}>
      {preset ? (
        <LinearGradient colors={preset} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      ) : photo ? (
        <>
          <SmartImage source={{ uri: photo }} blurRadius={45} contentFit="cover" style={{ position: "absolute", top: -60, left: -60, right: -60, bottom: -60 }} />
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.28)" }} />
        </>
      ) : (
        <LinearGradient colors={["#3a3340", "#1c1a20", "#141417"]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      )}
      <LinearGradient colors={["rgba(0,0,0,0.42)", "rgba(0,0,0,0)", "rgba(0,0,0,0)", "rgba(0,0,0,0.5)"]} locations={[0, 0.24, 0.68, 1]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
    </View>
  );
}

/** One bar per status; the current one fills with `progress` (0..1). */
function NoteBars({ count, index, progress }: { count: number; index: number; progress?: Animated.Value }) {
  return (
    <View testID="note-bars" style={{ flexDirection: "row", gap: 4 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.3)" }}>
          {i < index || (i === index && !progress) ? (
            <View style={{ flex: 1, backgroundColor: WHITE }} />
          ) : i === index && progress ? (
            <Animated.View style={{ height: 3, backgroundColor: WHITE, width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function StageHead({ author, title, sub, onClose }: { author: StoryAuthor; title: string; sub: string; onClose: () => void }) {
  const { t } = useTranslation();
  const avatar = getAvatarUrl(author.avatarImageUrl, 36);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 }}>
      <Avatar uri={avatar && avatar !== "default-avatar" ? avatar : undefined} size={36} radius={11} name={nameOf(author)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: WHITE, fontSize: 15, fontWeight: "700" }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: WHITE_DIM, fontSize: 12.5 }}>{sub}</Text>
      </View>
      <Pressable testID="note-close" onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })} style={[{ width: 36, height: 36, alignItems: "center", justifyContent: "center", marginRight: -6 }, NO_OUTLINE]}>
        <Ionicons name="close" size={26} color={WHITE} />
      </Pressable>
    </View>
  );
}

/** A song under the words: artwork, title, play/pause. */
function StatusSong({ song, autoPlay }: { song: StorySong; autoPlay?: boolean }) {
  const player = useAudioPlayer({ uri: song.audioUrl });
  const [playing, setPlaying] = useState(false);
  const start = () => {
    try {
      void player.seekTo((song.startMs || 0) / 1000);
      player.play();
      setPlaying(true);
    } catch { /* not loaded yet */ }
  };
  useEffect(() => {
    if (!autoPlay) return;
    const timer = setTimeout(start, 250);
    return () => { clearTimeout(timer); try { player.pause(); } catch { /* gone */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, song.audioUrl]);
  const toggle = () => {
    if (playing) { try { player.pause(); } catch { /* gone */ } setPlaying(false); return; }
    start();
  };
  return (
    <Pressable onPress={toggle} testID="note-song" accessibilityRole="button" accessibilityLabel={song.title} style={{ maxWidth: "100%" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, paddingLeft: 4, paddingRight: 12, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.16)" }}>
        {song.artworkUrl
          ? <SmartImage source={{ uri: song.artworkUrl }} style={{ width: 28, height: 28, borderRadius: 8 }} contentFit="cover" />
          : <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" }}><Ionicons name="musical-notes" size={15} color={WHITE} /></View>}
        <Text numberOfLines={1} style={{ flexShrink: 1, color: WHITE, fontSize: 13, fontWeight: "700" }}>{song.title}{song.artist ? ` · ${song.artist}` : ""}</Text>
        <Ionicons name={playing ? "pause" : "play"} size={12} color={WHITE} />
      </View>
    </Pressable>
  );
}

/** The middle of a status: GIF, big words, song, place. */
function StatusWords({ note, words, autoPlay, footer }: { note: Note; words: string; autoPlay?: boolean; footer?: React.ReactNode }) {
  const size = wordSize(stripBold(words));
  return (
    <View style={{ alignItems: "center", gap: 12, paddingHorizontal: 20, maxWidth: 440, alignSelf: "center" }}>
      {!!note.gifUrl && <SmartImage source={{ uri: note.gifUrl }} style={{ width: 200, height: 150, borderRadius: 16 }} contentFit="contain" />}
      {!!note.text && <Text testID="note-words" style={[{ color: WHITE, fontSize: size, lineHeight: Math.round(size * 1.18), fontWeight: "800", textAlign: "center" }, WORD_SHADOW]}><BoldText text={words} heavy /></Text>}
      {!!note.song && <StatusSong song={note.song} autoPlay={autoPlay} />}
      {!!note.location && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="location-outline" size={15} color={WHITE} />
          <Text style={[{ color: "rgba(255,255,255,0.86)", fontSize: 14, fontWeight: "600" }, WORD_SHADOW]}>{note.location}</Text>
        </View>
      )}
      {footer}
    </View>
  );
}

/** Tap a side to turn the page, swipe to turn it too, swipe down to close, hold to pause. */
function useStageGestures({ onPrev, onNext, onClose, setHeld }: { onPrev: () => void; onNext: () => void; onClose: () => void; setHeld: (v: boolean) => void }) {
  const { width } = useWindowDimensions();
  const latest = useRef({ onPrev, onNext, onClose, setHeld, width });
  latest.current = { onPrev, onNext, onClose, setHeld, width };
  const startedAt = useRef(0);
  return useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { startedAt.current = Date.now(); latest.current.setHeld(true); },
    onPanResponderRelease: (_e, g) => {
      const l = latest.current;
      l.setHeld(false);
      if (Math.abs(g.dx) > 50 && Math.abs(g.dx) > Math.abs(g.dy)) { if (g.dx < 0) l.onNext(); else l.onPrev(); return; }
      if (g.dy > 90 && g.dy > Math.abs(g.dx)) { l.onClose(); return; }
      if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10 && Date.now() - startedAt.current < 350) {
        if (g.x0 < l.width / 3) l.onPrev(); else l.onNext();
      }
    },
    onPanResponderTerminate: () => latest.current.setHeld(false),
  })).current.panHandlers;
}

/** One person's status, with the reply box and the heart. */
function NotePage({ entry, onSend, onTyping, gestures }: { entry: NoteEntry; onSend: (text: string) => void; onTyping: (typing: boolean) => void; gestures: object }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { note, author } = entry;
  const words = useNoteWords(note.text);
  const name = nameOf(author);
  const [liked, setLiked] = useState(!!note.liked);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  useEffect(() => { onTyping(focused || !!text.trim()); }, [focused, text, onTyping]);
  const pop = useRef(new Animated.Value(1)).current;
  const toggleLike = () => {
    const next = !liked;
    setLiked(next);
    if (next) {
      pop.setValue(0.6);
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, damping: 8, stiffness: 260 }).start();
    }
    likeNote(note.id, next)
      .then(() => { note.liked = next; void qc.invalidateQueries({ queryKey: NOTES_QUERY_KEY }); })
      .catch(() => setLiked(!next));
  };
  const send = () => {
    const reply = text.trim();
    if (!reply) return;
    // The note's words ride along, so the chat shows what was answered.
    onSend(note.text ? `📝 “${note.text}”\n${reply}` : reply);
  };
  const replyLabel = t("notes.replyTo", { defaultValue: "Reply to {{name}}…", name });
  const chipLabel = words.isLoading
    ? t("stories.translating", { defaultValue: "Translating…" })
    : words.isTranslated
      ? t("stories.seeOriginal", { defaultValue: "See original" })
      : t("stories.translate", { defaultValue: "Translate" });
  return (
    <>
      <View {...gestures} style={{ flex: 1, justifyContent: "center" }}>
        <StatusWords
          note={note}
          words={words.shown}
          autoPlay
          footer={!!note.text && words.offer ? (
            <Pressable testID="note-translate" onPress={words.isTranslated ? words.showOriginal : () => void words.translate()} disabled={words.isLoading} hitSlop={8} accessibilityRole="button" accessibilityLabel={chipLabel}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                {words.isLoading ? <ActivityIndicator size="small" color={WHITE} style={{ transform: [{ scale: 0.7 }] }} /> : <Ionicons name="language" size={14} color={WHITE_DIM} />}
                <Text style={[{ color: WHITE_DIM, fontSize: 12.5, fontWeight: "600" }, WORD_SHADOW]}>{chipLabel}</Text>
              </View>
            </Pressable>
          ) : null}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TextInput
          testID="note-reply"
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={1000}
          placeholder={replyLabel}
          accessibilityLabel={replyLabel}
          placeholderTextColor="rgba(255,255,255,0.6)"
          returnKeyType="send"
          onSubmitEditing={send}
          style={[{ flex: 1, height: 48, borderRadius: 14, paddingHorizontal: 16, color: WHITE, fontSize: 15 }, GLASS, NO_OUTLINE]}
        />
        {text.trim() ? (
          <Pressable onPress={send} accessibilityRole="button" accessibilityLabel={t("notes.send", { defaultValue: "Send" })}>
            <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: WHITE, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="send" size={18} color={INK} />
            </View>
          </Pressable>
        ) : (
          <Pressable testID="note-like" onPress={toggleLike} accessibilityRole="button" accessibilityLabel={liked ? t("notes.unlike", { defaultValue: "Unlike" }) : t("notes.like", { defaultValue: "Like" })}>
            <View style={[{ width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" }, GLASS]}>
              <Animated.View style={{ transform: [{ scale: pop }] }}>
                <Ionicons name={liked ? "heart" : "heart-outline"} size={22} color={liked ? "#ff3b5c" : WHITE} />
              </Animated.View>
            </View>
          </Pressable>
        )}
      </View>
    </>
  );
}

/** Everyone's statuses, one after another, starting at the one you tapped. */
function NoteStage({ entries, start, onClose, onSend }: { entries: NoteEntry[]; start: number; onClose: () => void; onSend: (entry: NoteEntry, text: string) => void }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(start);
  const [held, setHeld] = useState(false);
  const [typing, setTyping] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const at = useRef(0);
  useEffect(() => {
    const id = progress.addListener(({ value }) => { at.current = value; });
    return () => progress.removeListener(id);
  }, [progress]);
  const last = entries.length - 1;
  const next = () => { if (index >= last) onClose(); else setIndex(index + 1); };
  const prev = () => setIndex(Math.max(0, index - 1));
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => { progress.setValue(0); at.current = 0; }, [index, progress]);
  const paused = held || typing;
  useEffect(() => {
    if (paused) return;
    const anim = Animated.timing(progress, { toValue: 1, duration: Math.max(0, NOTE_PAGE_MS * (1 - at.current)), easing: Easing.linear, useNativeDriver: false });
    anim.start(({ finished }) => { if (finished) nextRef.current(); });
    return () => anim.stop();
  }, [index, paused, progress]);
  const gestures = useStageGestures({ onPrev: prev, onNext: next, onClose, setHeld });
  const pad = useStagePad();
  const entry = entries[Math.min(index, last)];
  if (!entry) return null;
  const ago = shortSpan(Date.now() - Date.parse(entry.note.postedAt));
  return (
    <View testID="note-stage" style={{ flex: 1 }}>
      <Backdrop key={entry.note.id} author={entry.author} background={entry.note.background} />
      <View style={pad}>
        <NoteBars count={entries.length} index={index} progress={progress} />
        <StageHead author={entry.author} title={nameOf(entry.author)} sub={t("notes.postedAgo", { defaultValue: "{{time}} ago", time: ago })} onClose={onClose} />
        <NotePage key={entry.note.id} entry={entry} gestures={gestures} onSend={(text) => onSend(entry, text)} onTyping={setTyping} />
      </View>
    </View>
  );
}

/** Your own status: how long it has left, who hearted it, edit or delete. */
function MyNoteStage({ entry, onEdit, onClose }: { entry: NoteEntry; onEdit: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const likers = entry.likers ?? [];
  const count = Math.max(entry.note.likeCount ?? 0, likers.length);
  const left = shortSpan(Date.parse(entry.note.expiresAt) - Date.now());
  const remove = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: NOTES_QUERY_KEY }); onClose(); },
    onError: () => toastError(t("notes.failed", { defaultValue: "Your status didn't go up. Try again." })),
  });
  const pad = useStagePad();
  const soft = { height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.13)" } as const;
  return (
    <View testID="note-stage-mine" style={{ flex: 1 }}>
      <Backdrop author={entry.author} background={entry.note.background} />
      <View style={pad}>
      <NoteBars count={1} index={0} />
      <StageHead author={entry.author} title={t("notes.yourStatus", { defaultValue: "Your status" })} sub={t("notes.timeLeft", { defaultValue: "{{time}} left", time: left })} onClose={onClose} />
      <View style={{ flex: 1, justifyContent: "center" }}>
        <StatusWords note={entry.note} words={entry.note.text ?? ""} />
      </View>
      <View style={{ borderRadius: 18, padding: 10, backgroundColor: "rgba(0,0,0,0.38)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" }}>
        {count > 0 ? (
          <View testID="note-likers" style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6, paddingTop: 4, marginBottom: 10 }}>
            <Ionicons name="heart" size={20} color="#ff3b5c" />
            <View style={{ flexDirection: "row" }}>
              {likers.slice(0, 3).map((a, i) => {
                const uri = getAvatarUrl(a.avatarImageUrl, 26);
                return (
                  <View key={a.address} style={{ marginLeft: i ? -8 : 0, borderRadius: 9, borderWidth: 2, borderColor: "rgba(0,0,0,0.55)" }}>
                    <Avatar uri={uri && uri !== "default-avatar" ? uri : undefined} size={26} radius={8} name={nameOf(a)} />
                  </View>
                );
              })}
            </View>
            <Text numberOfLines={1} style={{ color: WHITE, flex: 1, fontSize: 13.5, fontWeight: "600" }}>
              {likers.length && count > 1
                ? t("notes.likedByMore", { defaultValue: "Liked by {{name}} and {{others}} more", name: nameOf(likers[0]), others: formatCount(count - 1) })
                : likers.length
                  ? t("notes.likedBy", { defaultValue: "Liked by {{name}}", name: nameOf(likers[0]) })
                  : t("notes.likes", { defaultValue: "{{total}} likes", total: formatCount(count) })}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable testID="note-edit" onPress={onEdit} accessibilityRole="button" style={{ flex: 1 }}>
            <View style={soft}><Text style={{ color: WHITE, fontSize: 15, fontWeight: "700" }}>{t("notes.edit", { defaultValue: "Edit" })}</Text></View>
          </Pressable>
          <Pressable testID="note-delete" onPress={() => remove.mutate()} disabled={remove.isPending} accessibilityRole="button" style={{ flex: 1, opacity: remove.isPending ? 0.5 : 1 }}>
            <View style={soft}><Text style={{ color: "#ff6b7d", fontSize: 15, fontWeight: "700" }}>{t("notes.deleteShort", { defaultValue: "Delete" })}</Text></View>
          </Pressable>
        </View>
      </View>
      </View>
    </View>
  );
}

function ToolButton({ onPress, label, active, testID, children }: { onPress: () => void; label: string; active?: boolean; testID?: string; children: (color: string) => React.ReactNode }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      <View style={[{ width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" }, active ? { backgroundColor: WHITE } : GLASS]}>
        {children(active ? INK : WHITE)}
      </View>
    </Pressable>
  );
}

/** Writing a status: big words over the backdrop you pick, Song / GIF / Place down the side. */
function NoteWriter({ me, mine, onClose }: { me: StoryAuthor; mine: Note | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState(mine?.text ?? "");
  const [location, setLocation] = useState(mine?.location ?? "");
  const [showPlace, setShowPlace] = useState(!!mine?.location);
  const [gifUrl, setGifUrl] = useState<string | null>(mine?.gifUrl ?? null);
  const [song, setSong] = useState<StorySong | null>(mine?.song ?? null);
  const [background, setBackground] = useState<string>(mine?.background && (BACKDROP_KEYS as readonly string[]).includes(mine.background) ? mine.background : "photo");
  const [gifOpen, setGifOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const size = wordSize(text || "Share a thought");

  const save = useMutation({
    mutationFn: (input: NoteInput) => putNote(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: NOTES_QUERY_KEY }); toastSuccess(t("notes.shared", { defaultValue: "Your status is up for 24 hours" })); onClose(); },
    onError: () => toastError(t("notes.failed", { defaultValue: "Your status didn't go up. Try again." })),
  });

  const empty = !text.trim() && !location.trim() && !gifUrl && !song;
  const share = () => {
    if (empty || save.isPending) return;
    save.mutate({
      ...(text.trim() && { text: text.trim() }),
      ...(location.trim() && { location: location.trim() }),
      ...(gifUrl && { gifUrl }),
      ...(song && { song }),
      ...(background !== "photo" && { background }),
    });
  };
  const avatar = getAvatarUrl(me.avatarImageUrl, 36);
  const pad = useStagePad();

  return (
    <View testID="note-writer" style={{ flex: 1 }}>
      <Backdrop author={me} background={background} />
      <View style={pad}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 40 }}>
        <Pressable testID="note-cancel" onPress={onClose} hitSlop={8} accessibilityRole="button" style={{ width: 84 }}>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "600" }}>{t("common.cancel", { defaultValue: "Cancel" })}</Text>
        </Pressable>
        <Text style={{ color: WHITE, fontSize: 16, fontWeight: "700" }}>{t("notes.newStatus", { defaultValue: "New status" })}</Text>
        <View style={{ width: 84, alignItems: "flex-end" }}>
          <Pressable testID="note-share" onPress={share} disabled={empty || save.isPending} accessibilityRole="button" style={{ opacity: empty ? 0.45 : 1 }}>
            <View style={{ height: 36, minWidth: 72, paddingHorizontal: 16, borderRadius: 11, backgroundColor: WHITE, alignItems: "center", justifyContent: "center" }}>
              {save.isPending ? <ActivityIndicator size="small" color={INK} /> : <Text style={{ color: INK, fontSize: 14.5, fontWeight: "700" }}>{t("notes.share", { defaultValue: "Share" })}</Text>}
            </View>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1, justifyContent: "center" }}>
        <View style={{ alignItems: "center", gap: 12, paddingHorizontal: 56 }}>
          {!!gifUrl && (
            <View>
              <SmartImage source={{ uri: gifUrl }} style={{ width: 190, height: 140, borderRadius: 16 }} contentFit="contain" />
              <TouchableOpacity onPress={() => setGifUrl(null)} accessibilityLabel={t("notes.removeGif", { defaultValue: "Remove GIF" })} style={{ position: "absolute", right: 6, top: 6, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 8, padding: 4 }}>
                <Ionicons name="close" size={14} color={WHITE} />
              </TouchableOpacity>
            </View>
          )}
          <TextInput
            testID="note-text"
            value={text}
            onChangeText={(v) => setText(v.replace(/\n/g, " "))}
            maxLength={NOTE_TEXT_MAX}
            autoFocus
            multiline
            blurOnSubmit
            returnKeyType="done"
            onSubmitEditing={share}
            placeholder={t("notes.placeholder", { defaultValue: "Share a thought…" })}
            placeholderTextColor="rgba(255,255,255,0.55)"
            selectionColor={WHITE}
            style={[{ alignSelf: "stretch", padding: 0, borderWidth: 0, color: WHITE, fontSize: size, lineHeight: Math.round(size * 1.18), fontWeight: "800", textAlign: "center" }, WORD_SHADOW, NO_OUTLINE]}
          />
          <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>{t("notes.charsLeft", { defaultValue: "{{count}} left", count: NOTE_TEXT_MAX - text.length })}</Text>
          {!!song && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" }}>
              <View style={{ flexShrink: 1 }}><StatusSong song={song} /></View>
              <TouchableOpacity onPress={() => setSong(null)} accessibilityLabel={t("notes.removeSong", { defaultValue: "Remove song" })} style={{ padding: 4 }}>
                <Ionicons name="close" size={16} color={WHITE} />
              </TouchableOpacity>
            </View>
          )}
          {showPlace && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="location-outline" size={15} color={WHITE} />
              <TextInput
                value={location}
                onChangeText={setLocation}
                maxLength={NOTE_LOCATION_MAX}
                placeholder={t("notes.placePlaceholder", { defaultValue: "Where are you?" })}
                placeholderTextColor="rgba(255,255,255,0.55)"
                style={[{ minWidth: 130, padding: 0, borderWidth: 0, color: WHITE, fontSize: 14, fontWeight: "600", textAlign: "center" }, NO_OUTLINE]}
              />
              <TouchableOpacity onPress={() => { setLocation(""); setShowPlace(false); }} accessibilityLabel={t("notes.removePlace", { defaultValue: "Remove place" })}>
                <Ionicons name="close" size={15} color={WHITE} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        <View style={{ position: "absolute", right: 0, gap: 8 }}>
          <ToolButton testID="note-add-song" active={!!song} label={t("notes.song", { defaultValue: "Song" })} onPress={() => setSoundOpen(true)}>
            {(color) => <Ionicons name="musical-notes-outline" size={20} color={color} />}
          </ToolButton>
          <ToolButton testID="note-add-gif" active={!!gifUrl} label="GIF" onPress={() => setGifOpen(true)}>
            {(color) => <Text style={{ color, fontSize: 12, fontWeight: "800" }}>GIF</Text>}
          </ToolButton>
          <ToolButton testID="note-add-place" active={showPlace} label={t("notes.place", { defaultValue: "Place" })} onPress={() => setShowPlace(true)}>
            {(color) => <Ionicons name="location-outline" size={20} color={color} />}
          </ToolButton>
        </View>
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel={t("notes.background", { defaultValue: "Background" })} style={{ flexDirection: "row", justifyContent: "center", gap: 10 }}>
        {BACKDROP_KEYS.map((key) => {
          const on = background === key;
          return (
            <Pressable key={key} testID={`note-backdrop-pick-${key}`} onPress={() => setBackground(key)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={key === "photo" ? t("notes.yourPhoto", { defaultValue: "Your photo" }) : key}>
              <View style={{ width: 38, height: 38, borderRadius: 12, padding: 2, borderWidth: 2, borderColor: on ? WHITE : "transparent" }}>
                <View style={{ flex: 1, borderRadius: 9, overflow: "hidden", backgroundColor: "#27272a", borderWidth: on ? 0 : 1, borderColor: "rgba(255,255,255,0.35)" }}>
                  {key === "photo"
                    ? (avatar && avatar !== "default-avatar" ? <SmartImage source={{ uri: avatar }} style={{ flex: 1 }} contentFit="cover" /> : null)
                    : <LinearGradient colors={BACKDROPS[key]} style={{ flex: 1 }} />}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, textAlign: "center", marginTop: 10 }}>{t("notes.who", { defaultValue: "People who follow you can see it for 24 hours." })}</Text>
      </View>

      <GifPicker
        visible={gifOpen}
        onClose={() => setGifOpen(false)}
        onPick={(url) => {
          setGifOpen(false);
          if (isNoteGif(url)) setGifUrl(url);
          else toastError(t("notes.gifHost", { defaultValue: "Pick a GIF from the GIF tab for statuses." }));
        }}
      />
      {soundOpen && (
        <SoundPickerSheet
          visible={soundOpen}
          onClose={() => setSoundOpen(false)}
          onSelect={(sound) => { const next = songFrom(sound); if (next) setSong(next); setSoundOpen(false); }}
          clipSeconds={30}
          opaque
        />
      )}
    </View>
  );
}

/**
 * The strip at the top of Messages. It shows only for people who use Notes:
 * your own note, or notes from people you follow. Nobody else sees anything,
 * and Notes still open from the + for them.
 */
export function NotesStrip({ onOpen }: { onOpen: (entry: NoteEntry | null) => void }) {
  const { t } = useTranslation();
  const data = useVisibleNotes();
  const mine = data?.mine ?? null;
  const notes = data?.notes ?? [];
  if (!mine && notes.length === 0) return null;
  const placeholder = t("notes.add", { defaultValue: "Note" });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingHorizontal: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
      {mine && <NoteTile own author={mine.author} note={mine.note} label={t("notes.yourNote", { defaultValue: "Your note" })} placeholder={placeholder} onPress={() => onOpen(null)} />}
      {notes.map((entry) => (
        <NoteTile key={entry.note.id} author={entry.author} note={entry.note} label={nameOf(entry.author)} placeholder={placeholder} onPress={() => onOpen(entry)} />
      ))}
    </ScrollView>
  );
}

// ── Status row ───────────────────────────────────────────────────────────
// Statuses (notes) from people you follow sit in one row at the top of Chat,
// under the tabs and above the chat cards: a thought cloud over each
// face, yours first so you can post one. Same as web's StatusRow.

function cloudText(note: Note | null): string {
  if (!note) return "";
  if (note.text) return note.text;
  if (note.song) return `🎧 ${note.song.title}`;
  if (note.location) return `📍 ${note.location}`;
  return "";
}

const CLOUD = { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 } as const;

function StatusTile({ author, note, own, label, onPress, onMenu }: {
  author: StoryAuthor; note: Note | null; own?: boolean; label: string; onPress: () => void; onMenu: () => void;
}) {
  const { t } = useTranslation();
  const { isLight, pageColors } = useAppTheme();
  const avatar = getAvatarUrl(author.avatarImageUrl, 60);
  const said = useNoteWords(note?.text, own).shown;
  const gif = note?.gifUrl || null;
  const left = useNoteLeft(note);
  const words = gif ? "" : (note?.text ? said : cloudText(note)) || (own ? t("notes.whatsUp", { defaultValue: "What\u2019s up?" }) : "");
  const tileLabel = gif ? author.username || nameOf(author) : label;
  const cloud = { ...CLOUD, backgroundColor: pageColors.foreground };
  const hair = isLight ? { borderWidth: 1, borderColor: "rgba(0,0,0,0.08)" } : null;
  return (
    <Pressable onPress={onPress} onLongPress={onMenu} style={{ width: 86, alignItems: "center" }} accessibilityRole="button" accessibilityLabel={words ? `${tileLabel}: ${stripBold(words)}` : tileLabel}
      accessibilityActions={[{ name: "statusOptions", label: t("notes.statusOptions", { defaultValue: "Status options" }) }]}
      onAccessibilityAction={event => { if (event.nativeEvent.actionName === "statusOptions") onMenu(); }}>
      {/* The palette already supplies the light and dark colors for this bubble. */}
      <View className="dark-surface" style={{ minHeight: 60, paddingTop: 2, width: "100%", alignItems: "center", justifyContent: "flex-end" }}>
        {words ? (
          <>
            <View style={[cloud, hair, { maxWidth: 84, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7 }]}>
              <Text numberOfLines={2} style={{ fontSize: 11.5, lineHeight: 14, fontWeight: "600", textAlign: "center", color: pageColors.background }}><BoldText text={words} heavy /></Text>
            </View>
            <View style={{ width: "100%", paddingLeft: 26 }}>
              <View style={[cloud, hair, { width: 8, height: 8, borderRadius: 4, marginTop: 2 }]} />
              <View style={[cloud, hair, { width: 4, height: 4, borderRadius: 2, marginTop: 1, marginLeft: 6 }]} />
            </View>
          </>
        ) : null}
      </View>
      <View style={{ marginTop: 2, width: 66, height: 66, alignItems: "center", justifyContent: "center" }}>
        {gif
          ? <SmartImage source={{ uri: gif }} style={{ width: 58, height: 58, borderRadius: 11 }} contentFit="cover" />
          : <Avatar uri={avatar && avatar !== "default-avatar" ? avatar : undefined} size={58} radius={11} name={nameOf(author)} />}
        {note ? <NoteRing left={left} size={66} /> : null}
        {own && !gif ? (
          <View style={{ position: "absolute", right: -4, bottom: -4, width: 22, height: 22, borderRadius: 6, backgroundColor: isLight ? "#111114" : "#fff", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: isLight ? "#fff" : "#000" }}>
            <Ionicons name="add" size={14} color={isLight ? "#fff" : "#0b0b0c"} />
          </View>
        ) : null}
      </View>
      <Text className={own ? "text-theme-neutrals-400" : "text-white"} numberOfLines={1} style={{ marginTop: 6, maxWidth: 82, fontSize: 11.5, fontWeight: "600" }}>{tileLabel}</Text>
    </Pressable>
  );
}

/** The Status row at the top of Chat, for signed-in people. */
export function StatusRow({ me, onOpen }: { me: StoryAuthor | null; onOpen: (entry: NoteEntry | null) => void }) {
  const { t } = useTranslation();
  const c = useNoteInk();
  const queryClient = useQueryClient();
  const { statusesHidden } = useActivityShelfPreferences();
  const [menu, setMenu] = useState<{ target?: ActivityTarget } | null>();
  const data = useVisibleNotes(!statusesHidden);
  const mine = data?.mine ?? null;
  const notes = data?.notes ?? [];
  const self = mine?.author ?? me;
  if (!self) return null;
  if (statusesHidden) {
    return <Pressable accessibilityRole="button" onPress={() => { setMenu(null); setActivityBarHidden(false, "status"); }}
      style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 14, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: c.bubble }}>
      <Ionicons name="eye-outline" size={16} color={c.ink} />
      <Text style={{ color: c.ink, fontSize: 13, fontWeight: "600" }}>{t("notes.showStatusBar", { defaultValue: "Show status bar" })}</Text>
    </Pressable>;
  }
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingHorizontal: 14, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
        <StatusTile own author={self} note={mine?.note ?? null} label={t("notes.yourStatus", { defaultValue: "Your status" })} onPress={() => onOpen(null)} onMenu={() => setMenu({})} />
        {notes.map((entry) => (
          <StatusTile key={entry.note.id} author={entry.author} note={entry.note} label={nameOf(entry.author)} onPress={() => onOpen(entry)}
            onMenu={() => setMenu({ target: { kind: "status", ids: [statusKey(entry)], creator: entry.author.address, open: () => onOpen(entry) } })} />
        ))}
      </ScrollView>
      {menu !== undefined && <ActivityShelfMenu target={menu?.target} visible={!!menu} onClose={() => setMenu(null)} bar="status"
        onModerated={() => { void queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY }); }} />}
    </>
  );
}

// ── Notes in the chat list ───────────────────────────────────────────────
// A person's note rides in their own chat card; notes from members of a
// group ride in that group's card (and atop the open group chat). There is no
// separate strip, so the cards stay one clean stack. Same as web's NotesRow.

const lower = (a?: string | null) => (a || "").toLowerCase();

/** Notes by author wallet (lower case). */
export function useNotesByAuthor(enabled = true): Map<string, NoteEntry> {
  const data = useVisibleNotes(enabled);
  return React.useMemo(() => new Map((data?.notes ?? []).map((e) => [lower(e.author.address), e])), [data]);
}

/** Notes of people you follow who are in each of these groups. */
export function useGroupNotes(groupIds: string[], me: string | null): Record<string, NoteEntry[]> {
  const byAuthor = useNotesByAuthor(!!me);
  const ids = React.useMemo(() => groupIds.slice().sort(), [groupIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const wallets = React.useMemo(() => [...new Set([...byAuthor.values()].flatMap((e) => [e.author.address, lower(e.author.address)]))], [byAuthor]);
  const { data } = useQuery({
    queryKey: ["dm-group-notes", ids.join(","), wallets.join(",")],
    enabled: !!me && ids.length > 0 && wallets.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows } = await withWalletHeader(
        supabase.from("community_members").select("community_id, wallet_address").in("community_id", ids).in("wallet_address", wallets).eq("status", "active"),
        me,
      );
      return (rows ?? []) as { community_id: string; wallet_address: string }[];
    },
  });
  return React.useMemo(() => {
    const out: Record<string, NoteEntry[]> = {};
    for (const row of data ?? []) {
      const entry = byAuthor.get(lower(row.wallet_address));
      if (!entry) continue;
      const list = (out[row.community_id] ||= []);
      if (!list.includes(entry)) list.push(entry);
    }
    return out;
  }, [data, byAuthor]);
}

const noteLine = (n: Note) => n.text || n.song?.title || n.location || (n.gifUrl ? "GIF" : "");

/** The note as a small tag at the start of a chat's preview line. */
export function NoteTag({ entry, onPress }: { entry: NoteEntry; onPress: () => void }) {
  const c = useNoteInk();
  const said = useNoteWords(entry.note.text).shown;
  const line = entry.note.text ? stripBold(said) : noteLine(entry.note);
  if (!line) return null;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      testID="note-tag"
      style={{ flexDirection: "row", alignItems: "center", gap: 3, maxWidth: "60%", height: 20, paddingHorizontal: 6, borderRadius: 6, backgroundColor: c.bubble, borderWidth: 1, borderColor: c.hairline }}
    >
      {!entry.note.text && !!entry.note.song && <Ionicons name="musical-notes" size={11} color={c.ink} />}
      {!entry.note.text && !entry.note.song && !!entry.note.location && <Ionicons name="location" size={11} color={c.ink} />}
      <Text style={{ color: c.ink, fontSize: 12, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>{line}</Text>
    </Pressable>
  );
}

/** The 24h ring around a chat card's face (a 44px rounded square). */
export function NoteFaceRing({ note, size = 44, radius = 10 }: { note: Note; size?: number; radius?: number }) {
  const left = useNoteLeft(note);
  const ring = size + 10;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: -5, top: -5, width: ring, height: ring }}>
      <NoteRing left={left} size={ring} radius={radius + 5} />
    </View>
  );
}

/**
 * Notes from members of a group, inside its chat card: the newest one as a
 * tag, and a Notes button that drops the card down to show them all.
 */
export function GroupCardNotes({ notes, onOpen }: { notes: NoteEntry[]; onOpen: (entry: NoteEntry) => void }) {
  const { t } = useTranslation();
  const c = useNoteInk();
  const [open, setOpen] = useState(false);
  if (!notes.length) return null;
  const first = notes[0];
  const placeholder = t("notes.add", { defaultValue: "Note" });
  return (
    <View testID={open ? "group-notes-open" : "group-notes-closed"} style={{ marginTop: 8, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        {open ? (
          <Text style={{ color: c.ink2, fontSize: 12, flex: 1 }} numberOfLines={1}>{t("notes.inGroup", { defaultValue: "Notes from this group" })}</Text>
        ) : (
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Avatar uri={(() => { const u = getAvatarUrl(first.author.avatarImageUrl, 40); return u && u !== "default-avatar" ? u : undefined; })()} size={20} radius={6} name={nameOf(first.author)} />
            <NoteTag entry={first} onPress={() => onOpen(first)} />
          </View>
        )}
        <Pressable
          onPress={() => setOpen((v) => !v)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          testID="group-notes-toggle"
          style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 30, paddingHorizontal: 10, borderRadius: 10, backgroundColor: open ? c.primaryBg : c.field, borderWidth: open ? 0 : 1, borderColor: c.hairline }}
        >
          <Text style={{ color: open ? c.primaryInk : c.ink, fontSize: 12, fontWeight: "600" }}>
            {open ? t("notes.hide", { defaultValue: "Hide" }) : t("notes.count", { defaultValue: "Notes {{count}}", count: notes.length })}
          </Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={13} color={open ? c.primaryInk : c.ink} />
        </Pressable>
      </View>
      {open && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginLeft: -4 }}>
          {notes.map((e) => (
            <NoteTile key={e.note.id} author={e.author} note={e.note} label={nameOf(e.author)} placeholder={placeholder} onPress={() => onOpen(e)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Notes from the group's members, in a row across the top of the open group chat. */
export function GroupChatNotesRow({ groupId, me, onOpen }: { groupId: string; me: string | null; onOpen: (entry: NoteEntry) => void }) {
  const { t } = useTranslation();
  const c = useNoteInk();
  const notes = useGroupNotes(groupId ? [groupId] : [], me)[groupId] ?? [];
  if (!notes.length) return null;
  const placeholder = t("notes.add", { defaultValue: "Note" });
  return (
    <View testID="group-chat-notes" style={{ borderBottomWidth: 1, borderBottomColor: c.hairline }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingHorizontal: 12, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
        {notes.map((e) => (
          <NoteTile key={e.note.id} author={e.author} note={e.note} label={nameOf(e.author)} placeholder={placeholder} onPress={() => onOpen(e)} />
        ))}
      </ScrollView>
    </View>
  );
}

export default function NotesSheet({ visible, onClose, onMessage, initialView = null }: { visible: boolean; onClose: () => void; onMessage: (a: StoryAuthor, reply?: string) => void; initialView?: NoteEntry | null }) {
  const user = useUser() as any;
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: getNotes, staleTime: 60_000, enabled: visible });
  // What opens: someone's statuses (from the one tapped on), your own, or the writer.
  const [viewing, setViewing] = useState<{ entries: NoteEntry[]; start: number } | null>(null);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    setWriting(false);
    if (!visible || !initialView) { setViewing(null); return; }
    // The list is taken once, so a refresh mid-view never moves the page.
    const list = visibleNotes(qc.getQueryData<{ notes: NoteEntry[] }>(NOTES_QUERY_KEY)?.notes ?? [], getActivityShelfPreferences().dismissed);
    const at = list.findIndex((e) => e.note.id === initialView.note.id);
    setViewing(at >= 0 ? { entries: list, start: at } : { entries: [initialView], start: 0 });
  }, [visible, initialView, qc]);
  const mineEntry = data?.mine ?? null;
  const address = (user?.address || user?.walletAddress || "") as string;
  const self: StoryAuthor | null = mineEntry?.author
    ?? (address ? { address, username: user?.username ?? null, displayName: user?.displayName ?? null, avatarImageUrl: user?.avatarImageUrl || user?.avatarUrl || null } as StoryAuthor : null);
  const showMine = !viewing && !writing && !!mineEntry;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View className="dark-surface" style={{ flex: 1, backgroundColor: "#000" }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View testID={viewing ? "note-sheet-view" : showMine ? "note-sheet-mine" : "note-sheet-write"} style={{ flex: 1 }}>
            {viewing ? (
              <NoteStage entries={viewing.entries} start={viewing.start} onClose={onClose} onSend={(entry, reply) => { onClose(); onMessage(entry.author, reply); }} />
            ) : showMine ? (
              <MyNoteStage entry={mineEntry!} onEdit={() => setWriting(true)} onClose={onClose} />
            ) : visible && self ? (
              <NoteWriter key={mineEntry?.note.id ?? "new"} me={self} mine={writing ? mineEntry?.note ?? null : null} onClose={onClose} />
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#fff" /></View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
