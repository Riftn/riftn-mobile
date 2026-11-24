/**
 * Notes
 * =====
 * A note is a short line with an optional song, GIF or place that stays up for
 * 24 hours. It opens like Instagram Notes: the person's face big with the
 * white cloud above it, you write yours in the cloud, a heart likes it.
 * Same as web's components/app/chat/NotesRow.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
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
import { DrawerSurface } from "../ui/SheetGlass";
import { useAppTheme } from "../../context/ThemeContext";
import { supabase } from "../../services/supabase";
import { withWalletHeader } from "../../libs/supabase-wallet-client";
import SheetBackdrop, { useSheetBackdrop } from "../ui/SheetBackdrop";
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

export const NOTES_QUERY_KEY = ["dm-notes"] as const;

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
      {!!note.text && <Text className="text-white text-[11px] text-center" numberOfLines={2}>{words}</Text>}
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

function PillButton({ icon, label, onPress, primary, disabled, small, active, danger }: { icon?: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; disabled?: boolean; small?: boolean; active?: boolean; danger?: boolean }) {
  const c = useNoteInk();
  const ink = primary || active ? c.primaryInk : danger ? "#ff5a6e" : c.ink;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={{ flexGrow: primary ? 1 : 0, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: small ? 34 : 42, paddingHorizontal: small ? 13 : 17, borderRadius: small ? 11 : 12, backgroundColor: primary || active ? c.primaryBg : c.field, borderWidth: primary || active ? 0 : 1, borderColor: c.hairline }}>
        {icon && <Ionicons name={icon} size={small ? 15 : 16} color={ink} />}
        <Text style={{ color: ink, fontSize: small ? 13 : 14, fontWeight: small ? "600" : "700" }}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── The open status (Instagram Notes style) ─────────────────────────────
// Tapping a status opens a short sheet: the person's face big, and the same
// white cloud as in the row above it, grown up. Writing your own happens IN
// that cloud, over your own face, so what you see is what friends see.
// Same as web's NotesRow (NoteView / MyNoteView / NoteComposer).

const CLOUD_INK = "#0b0b0c";
const CLOUD_SOFT = "rgba(11,11,12,0.55)";

/** "2h", "35m": short, like the chat list. */
function shortSpan(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "1m";
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function NoteTimes({ note, own }: { note: Note; own?: boolean }) {
  const { t } = useTranslation();
  const now = Date.now();
  const ago = shortSpan(now - Date.parse(note.postedAt));
  const left = shortSpan(Date.parse(note.expiresAt) - now);
  return (
    <Text className="text-theme-neutrals-400" style={{ fontSize: 12.5, marginTop: 2 }}>
      {own ? t("notes.upFor", { defaultValue: "Up {{time}}", time: ago }) : t("notes.postedAgo", { defaultValue: "{{time}} ago", time: ago })}
      {" · "}
      {t("notes.timeLeft", { defaultValue: "{{time}} left", time: left })}
    </Text>
  );
}

/** The big cloud with its two trailing dots, over a big squared face. Grows in when it opens. */
function BigCloud({ author, children }: { author: StoryAuthor; children: React.ReactNode }) {
  const { isLight } = useAppTheme();
  const avatar = getAvatarUrl(author.avatarImageUrl, 92);
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(grow, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 180, mass: 0.8 }).start();
  }, [grow]);
  const hair = isLight ? { borderWidth: 1, borderColor: "rgba(0,0,0,0.08)" } : null;
  return (
    <View style={{ alignItems: "center" }}>
      <Animated.View style={{ opacity: grow, transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }, { translateY: grow.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
        <View testID="note-cloud" style={[CLOUD, hair, { maxWidth: 264, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 12, alignItems: "center" }]}>
          {children}
        </View>
      </Animated.View>
      <View style={{ width: 110, paddingLeft: 30 }}>
        <View style={[CLOUD, hair, { width: 12, height: 12, borderRadius: 6, marginTop: 4 }]} />
        <View style={[CLOUD, hair, { width: 6, height: 6, borderRadius: 3, marginTop: 3, marginLeft: 9 }]} />
      </View>
      <View style={{ marginTop: 2 }}>
        <Avatar uri={avatar && avatar !== "default-avatar" ? avatar : undefined} size={92} radius={24} name={nameOf(author)} />
      </View>
    </View>
  );
}

/** A song inside the cloud: artwork, title, play/pause. */
function CloudSong({ song, autoPlay }: { song: StorySong; autoPlay?: boolean }) {
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
    <Pressable onPress={toggle} testID="note-song" accessibilityRole="button" accessibilityLabel={song.title} style={{ marginTop: 8, maxWidth: "100%" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 4, paddingLeft: 4, paddingRight: 10, borderRadius: 10, backgroundColor: "rgba(11,11,12,0.06)" }}>
        {song.artworkUrl
          ? <SmartImage source={{ uri: song.artworkUrl }} style={{ width: 24, height: 24, borderRadius: 6 }} contentFit="cover" />
          : <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: "rgba(11,11,12,0.1)", alignItems: "center", justifyContent: "center" }}><Ionicons name="musical-notes" size={13} color={CLOUD_INK} /></View>}
        <Text numberOfLines={1} style={{ flexShrink: 1, color: CLOUD_INK, fontSize: 12.5, fontWeight: "700" }}>{song.title}{song.artist ? ` · ${song.artist}` : ""}</Text>
        <Ionicons name={playing ? "pause" : "play"} size={12} color={CLOUD_INK} />
      </View>
    </Pressable>
  );
}

/** What goes inside the cloud for a note: GIF, words, song, place. */
function CloudBody({ note, words, autoPlay }: { note: Note; words: string; autoPlay?: boolean }) {
  return (
    <>
      {!!note.gifUrl && <SmartImage source={{ uri: note.gifUrl }} style={{ width: 160, height: 110, borderRadius: 12, marginBottom: 6 }} contentFit="contain" />}
      {!!note.text && <Text style={{ color: CLOUD_INK, fontSize: 17, lineHeight: 22, fontWeight: "700", textAlign: "center" }}>{words}</Text>}
      {!!note.song && <CloudSong song={note.song} autoPlay={autoPlay} />}
      {!!note.location && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 6 }}>
          <Ionicons name="location-outline" size={13} color={CLOUD_SOFT} />
          <Text style={{ color: CLOUD_SOFT, fontSize: 12.5, fontWeight: "600" }}>{note.location}</Text>
        </View>
      )}
    </>
  );
}

function SquareButton({ onPress, label, children, primary, testID }: { onPress: () => void; label: string; children: React.ReactNode; primary?: boolean; testID?: string }) {
  const c = useNoteInk();
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      <View style={{ width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: primary ? c.primaryBg : c.field, borderWidth: primary ? 0 : 1, borderColor: c.hairline }}>
        {children}
      </View>
    </Pressable>
  );
}

/** Someone else's status: big cloud, who and when, reply box and a heart. */
function NoteView({ entry, onSend }: { entry: NoteEntry; onSend: (text: string) => void }) {
  const c = useNoteInk();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { note, author } = entry;
  const words = useNoteWords(note.text);
  const name = nameOf(author);
  const [liked, setLiked] = useState(!!note.liked);
  const [text, setText] = useState("");
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
    <View style={{ alignItems: "center" }}>
      <BigCloud author={author}>
        <CloudBody note={note} words={words.shown} autoPlay />
      </BigCloud>
      <Text className="text-white" numberOfLines={1} style={{ marginTop: 10, fontSize: 16, fontWeight: "800" }}>{name}</Text>
      <NoteTimes note={note} />
      {!!note.text && words.offer ? (
        <Pressable
          testID="note-translate"
          onPress={words.isTranslated ? words.showOriginal : () => void words.translate()}
          disabled={words.isLoading}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={chipLabel}
          style={{ marginTop: 8 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {words.isLoading ? <ActivityIndicator size="small" color={c.ink2} style={{ transform: [{ scale: 0.7 }] }} /> : <Ionicons name="language" size={14} color={c.ink2} />}
            <Text style={{ color: c.ink2, fontSize: 12, fontWeight: "600" }}>{chipLabel}</Text>
          </View>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, alignSelf: "stretch" }}>
        <TextInput
          value={text}
          onChangeText={setText}
          maxLength={1000}
          placeholder={replyLabel}
          accessibilityLabel={replyLabel}
          placeholderTextColor="hsla(240, 5%, 55%, 1)"
          returnKeyType="send"
          onSubmitEditing={send}
          style={{ flex: 1, height: 44, borderRadius: 13, paddingHorizontal: 14, backgroundColor: c.field, color: c.ink, fontSize: 15, borderWidth: 1, borderColor: c.hairline }}
        />
        {text.trim() ? (
          <SquareButton primary onPress={send} label={t("notes.send", { defaultValue: "Send" })}>
            <Ionicons name="send" size={17} color={c.primaryInk} />
          </SquareButton>
        ) : (
          <SquareButton testID="note-like" onPress={toggleLike} label={liked ? t("notes.unlike", { defaultValue: "Unlike" }) : t("notes.like", { defaultValue: "Like" })}>
            <Animated.View style={{ transform: [{ scale: pop }] }}>
              <Ionicons name={liked ? "heart" : "heart-outline"} size={21} color={liked ? "#ff3b5c" : c.ink} />
            </Animated.View>
          </SquareButton>
        )}
      </View>
    </View>
  );
}

/** Your own status: big cloud, how long it has left, who hearted it, edit or delete. */
function MyNoteView({ entry, onEdit, onClose }: { entry: NoteEntry; onEdit: () => void; onClose: () => void }) {
  const c = useNoteInk();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const likers = entry.likers ?? [];
  const count = Math.max(entry.note.likeCount ?? 0, likers.length);
  const remove = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: NOTES_QUERY_KEY }); onClose(); },
    onError: () => toastError(t("notes.failed", { defaultValue: "Your status didn't go up. Try again." })),
  });
  return (
    <View style={{ alignItems: "center" }}>
      <BigCloud author={entry.author}>
        <CloudBody note={entry.note} words={entry.note.text ?? ""} />
      </BigCloud>
      <Text className="text-white" style={{ marginTop: 10, fontSize: 16, fontWeight: "800" }}>{t("notes.yourStatus", { defaultValue: "Your status" })}</Text>
      <NoteTimes note={entry.note} own />
      {count > 0 ? (
        <View testID="note-likers" style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: c.field, borderWidth: 1, borderColor: c.hairline }}>
          <Ionicons name="heart" size={20} color="#ff3b5c" />
          <View style={{ flexDirection: "row" }}>
            {likers.slice(0, 3).map((a, i) => {
              const uri = getAvatarUrl(a.avatarImageUrl, 26);
              return (
                <View key={a.address} style={{ marginLeft: i ? -8 : 0, borderRadius: 9, borderWidth: 2, borderColor: c.ring }}>
                  <Avatar uri={uri && uri !== "default-avatar" ? uri : undefined} size={26} radius={8} name={nameOf(a)} />
                </View>
              );
            })}
          </View>
          <Text className="text-white" numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: "600" }}>
            {likers.length && count > 1
              ? t("notes.likedByMore", { defaultValue: "Liked by {{name}} and {{others}} more", name: nameOf(likers[0]), others: formatCount(count - 1) })
              : likers.length
                ? t("notes.likedBy", { defaultValue: "Liked by {{name}}", name: nameOf(likers[0]) })
                : t("notes.likes", { defaultValue: "{{total}} likes", total: formatCount(count) })}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12, alignSelf: "stretch" }}>
        <View style={{ flex: 1 }}><PillButton label={t("notes.edit", { defaultValue: "Edit" })} onPress={onEdit} /></View>
        <View style={{ flex: 1 }}><PillButton label={t("notes.deleteShort", { defaultValue: "Delete" })} onPress={() => remove.mutate()} disabled={remove.isPending} danger /></View>
      </View>
    </View>
  );
}

function NoteComposer({ me, mine, onClose }: { me: StoryAuthor; mine: Note | null; onClose: () => void }) {
  const c = useNoteInk();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState(mine?.text ?? "");
  const [location, setLocation] = useState(mine?.location ?? "");
  const [showPlace, setShowPlace] = useState(!!mine?.location);
  const [gifUrl, setGifUrl] = useState<string | null>(mine?.gifUrl ?? null);
  const [song, setSong] = useState<StorySong | null>(mine?.song ?? null);
  const [gifOpen, setGifOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);

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
    });
  };

  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", alignSelf: "stretch", height: 36, marginBottom: 12 }}>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" style={{ width: 80 }}>
          <Text className="text-theme-neutrals-400" style={{ fontSize: 14, fontWeight: "600" }}>{t("common.cancel", { defaultValue: "Cancel" })}</Text>
        </Pressable>
        <Text className="text-white" style={{ fontSize: 15, fontWeight: "700" }}>{t("notes.newStatus", { defaultValue: "New status" })}</Text>
        <View style={{ width: 80, alignItems: "flex-end" }}>
          <Pressable testID="note-share" onPress={share} disabled={empty || save.isPending} accessibilityRole="button" style={{ opacity: empty ? 0.45 : 1 }}>
            <View style={{ height: 34, paddingHorizontal: 14, borderRadius: 11, backgroundColor: c.primaryBg, alignItems: "center", justifyContent: "center" }}>
              {save.isPending ? <ActivityIndicator size="small" color={c.primaryInk} /> : <Text style={{ color: c.primaryInk, fontSize: 13.5, fontWeight: "700" }}>{t("notes.share", { defaultValue: "Share" })}</Text>}
            </View>
          </Pressable>
        </View>
      </View>

      <BigCloud author={me}>
        {!!gifUrl && (
          <View style={{ marginBottom: 6 }}>
            <SmartImage source={{ uri: gifUrl }} style={{ width: 150, height: 104, borderRadius: 12 }} contentFit="contain" />
            <TouchableOpacity onPress={() => setGifUrl(null)} accessibilityLabel={t("notes.removeGif", { defaultValue: "Remove GIF" })} style={{ position: "absolute", right: 4, top: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 8, padding: 4 }}>
              <Ionicons name="close" size={14} color="#fff" />
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
          placeholderTextColor="rgba(11,11,12,0.4)"
          style={{ minWidth: 130, maxWidth: 228, padding: 0, color: CLOUD_INK, fontSize: 17, lineHeight: 22, fontWeight: "700", textAlign: "center" }}
        />
        {!!song && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <CloudSong song={song} />
            <TouchableOpacity onPress={() => setSong(null)} accessibilityLabel={t("notes.removeSong", { defaultValue: "Remove song" })} style={{ padding: 4, marginTop: 8 }}>
              <Ionicons name="close" size={14} color={CLOUD_SOFT} />
            </TouchableOpacity>
          </View>
        )}
        {showPlace && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
            <Ionicons name="location-outline" size={13} color={CLOUD_SOFT} />
            <TextInput
              value={location}
              onChangeText={setLocation}
              maxLength={NOTE_LOCATION_MAX}
              placeholder={t("notes.placePlaceholder", { defaultValue: "Where are you?" })}
              placeholderTextColor="rgba(11,11,12,0.4)"
              style={{ minWidth: 110, padding: 0, color: CLOUD_SOFT, fontSize: 12.5, fontWeight: "600", textAlign: "center" }}
            />
            <TouchableOpacity onPress={() => { setLocation(""); setShowPlace(false); }} accessibilityLabel={t("notes.removePlace", { defaultValue: "Remove place" })}>
              <Ionicons name="close" size={13} color={CLOUD_SOFT} />
            </TouchableOpacity>
          </View>
        )}
      </BigCloud>

      <Text className="text-theme-neutrals-500" style={{ fontSize: 11.5, marginTop: 8 }}>{t("notes.charsLeft", { defaultValue: "{{count}} left", count: NOTE_TEXT_MAX - text.length })}</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 12 }}>
        <PillButton small active={!!song} icon="musical-notes-outline" label={t("notes.song", { defaultValue: "Song" })} onPress={() => setSoundOpen(true)} />
        <PillButton small active={!!gifUrl} label="GIF" onPress={() => setGifOpen(true)} />
        <PillButton small active={showPlace} icon="location-outline" label={t("notes.place", { defaultValue: "Place" })} onPress={() => setShowPlace(true)} />
      </View>

      <Text className="text-theme-neutrals-500 text-[12px] text-center" style={{ marginTop: 12 }}>{t("notes.who", { defaultValue: "People who follow you can see it for 24 hours." })}</Text>

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
  const { data } = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: getNotes, staleTime: 60_000 });
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
// under the tabs and above the chat cards: a white thought cloud over each
// face, yours first so you can post one. Same as web's StatusRow.

function cloudText(note: Note | null): string {
  if (!note) return "";
  if (note.text) return note.text;
  if (note.song) return `🎧 ${note.song.title}`;
  if (note.location) return `📍 ${note.location}`;
  return note.gifUrl ? "GIF" : "";
}

// The "What's up?" hint is dark grey under 70 so the dark-theme readability
// pass (libs/jsx/readability.js) leaves it alone on the white cloud.
const CLOUD = { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 } as const;

function StatusTile({ author, note, own, label, onPress }: { author: StoryAuthor; note: Note | null; own?: boolean; label: string; onPress: () => void }) {
  const { t } = useTranslation();
  const { isLight } = useAppTheme();
  const avatar = getAvatarUrl(author.avatarImageUrl, 60);
  const said = useNoteWords(note?.text, own).shown;
  const words = (note?.text ? said : cloudText(note)) || (own ? t("notes.whatsUp", { defaultValue: "What\u2019s up?" }) : "");
  const gif = note?.gifUrl || null;
  const hair = isLight ? { borderWidth: 1, borderColor: "rgba(0,0,0,0.08)" } : null;
  return (
    <Pressable onPress={onPress} style={{ width: 86, alignItems: "center" }} accessibilityRole="button" accessibilityLabel={words ? `${label}: ${words}` : label}>
      <View style={{ height: 58, width: "100%", alignItems: "center", justifyContent: "flex-end" }}>
        {words ? (
          <>
            <View style={[CLOUD, hair, { maxWidth: 84, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 7 }]}>
              <Text numberOfLines={2} style={{ fontSize: 11.5, lineHeight: 14, fontWeight: "600", textAlign: "center", color: own && !note ? (isLight ? "#71717a" : "#3f3f46") : "#0b0b0c", opacity: own && !note && !isLight ? 0.75 : 1 }}>{words}</Text>
            </View>
            <View style={{ width: "100%", paddingLeft: 26 }}>
              <View style={[CLOUD, hair, { width: 8, height: 8, borderRadius: 4, marginTop: 2 }]} />
              <View style={[CLOUD, hair, { width: 4, height: 4, borderRadius: 2, marginTop: 1, marginLeft: 6 }]} />
            </View>
          </>
        ) : null}
      </View>
      <View style={{ marginTop: 2 }}>
        {gif
          ? <SmartImage source={{ uri: gif }} style={{ width: 58, height: 58, borderRadius: 11 }} contentFit="cover" />
          : <Avatar uri={avatar && avatar !== "default-avatar" ? avatar : undefined} size={58} radius={11} name={nameOf(author)} />}
        {own ? (
          <View style={{ position: "absolute", right: -4, bottom: -4, width: 22, height: 22, borderRadius: 6, backgroundColor: isLight ? "#111114" : "#fff", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: isLight ? "#fff" : "#000" }}>
            <Ionicons name="add" size={14} color={isLight ? "#fff" : "#0b0b0c"} />
          </View>
        ) : null}
      </View>
      <Text className={own ? "text-theme-neutrals-400" : "text-white"} numberOfLines={1} style={{ marginTop: 6, maxWidth: 82, fontSize: 11.5, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** The Status row at the top of Chat, for signed-in people. */
export function StatusRow({ me, onOpen }: { me: StoryAuthor | null; onOpen: (entry: NoteEntry | null) => void }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: getNotes, staleTime: 60_000 });
  const mine = data?.mine ?? null;
  const notes = data?.notes ?? [];
  const self = mine?.author ?? me;
  if (!self) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingHorizontal: 14, paddingBottom: 4 }} keyboardShouldPersistTaps="handled">
      <StatusTile own author={self} note={mine?.note ?? null} label={t("notes.yourStatus", { defaultValue: "Your status" })} onPress={() => onOpen(null)} />
      {notes.map((entry) => (
        <StatusTile key={entry.note.id} author={entry.author} note={entry.note} label={nameOf(entry.author)} onPress={() => onOpen(entry)} />
      ))}
    </ScrollView>
  );
}

// ── Notes in the chat list ───────────────────────────────────────────────
// A person's note rides in their own chat card; notes from members of a
// group ride in that group's card (and atop the open group chat). There is no
// separate strip, so the cards stay one clean stack. Same as web's NotesRow.

const lower = (a?: string | null) => (a || "").toLowerCase();

/** Notes by author wallet (lower case). */
export function useNotesByAuthor(enabled = true): Map<string, NoteEntry> {
  const { data } = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: getNotes, staleTime: 60_000, enabled });
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
  const line = entry.note.text ? said : noteLine(entry.note);
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
  const insets = useSafeAreaInsets();
  const user = useUser() as any;
  const backdrop = useSheetBackdrop(visible && Platform.OS !== "android");
  const { data } = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: getNotes, staleTime: 60_000, enabled: visible });
  // What the sheet shows: someone's status, your own, or the writer.
  const [viewing, setViewing] = useState<NoteEntry | null>(null);
  const [writing, setWriting] = useState(false);
  useEffect(() => { setViewing(visible ? initialView : null); setWriting(false); }, [visible, initialView]);
  const mineEntry = data?.mine ?? null;
  const address = (user?.address || user?.walletAddress || "") as string;
  const self: StoryAuthor | null = mineEntry?.author
    ?? (address ? { address, username: user?.username ?? null, displayName: user?.displayName ?? null, avatarImageUrl: user?.avatarImageUrl || user?.avatarUrl || null } as StoryAuthor : null);
  const showMine = !viewing && !writing && !!mineEntry;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent statusBarTranslucent navigationBarTranslucent>
      <SheetBackdrop backdrop={backdrop} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1 }} />
        <View testID={viewing ? "note-sheet-view" : showMine ? "note-sheet-mine" : "note-sheet-write"} className="overflow-hidden rounded-t-[28px] border-t border-white/10" style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 16, maxHeight: "92%" }}>
          <DrawerSurface backdropBlurred={backdrop.blurred} />
          <View className="bg-white/25" style={{ alignSelf: "center", width: 38, height: 5, borderRadius: 3, marginBottom: 12 }} />
          {viewing ? (
            <NoteView key={viewing.note.id} entry={viewing} onSend={(reply) => { const a = viewing.author; onClose(); onMessage(a, reply); }} />
          ) : showMine ? (
            <MyNoteView entry={mineEntry!} onEdit={() => setWriting(true)} onClose={onClose} />
          ) : visible && self ? (
            <NoteComposer key={mineEntry?.note.id ?? "new"} me={self} mine={writing ? mineEntry?.note ?? null : null} onClose={onClose} />
          ) : (
            <View style={{ paddingVertical: 40, alignItems: "center" }}><ActivityIndicator /></View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
