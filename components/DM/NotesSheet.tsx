/**
 * Notes
 * =====
 * A note is a short line with an optional song, GIF or place that stays up for
 * 24 hours. Same as web's components/app/chat/NotesRow.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
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
import SheetBackdrop, { useSheetBackdrop } from "../ui/SheetBackdrop";
import { getAvatarUrl } from "../../libs/misc";
import { playableSoundUrl, soundWindow } from "../../libs/soundWindow";
import { toastError, toastSuccess } from "../../libs/toast";
import type { AttachedSound } from "../../hooks/usePostSound";
import type { StoryAuthor, StorySong } from "../../services/stories.service";
import {
  deleteNote, getNotes, isNoteGif, NOTE_LOCATION_MAX, NOTE_TEXT_MAX, putNote,
  type Note, type NoteEntry, type NoteInput,
} from "../../services/notes.service";

export const NOTES_QUERY_KEY = ["dm-notes"] as const;

const nameOf = (a: StoryAuthor) => a.displayName || a.username || `${a.address.slice(0, 6)}…`;
const BUBBLE = "hsla(240, 5%, 96%, 0.12)";
const FIELD = "hsla(240, 5%, 96%, 0.08)";

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

function NoteBubble({ note, placeholder }: { note: Note | null; placeholder: string }) {
  if (!note) {
    return (
      <View style={{ backgroundColor: FIELD, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 84, flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Ionicons name="add" size={12} color="hsla(240, 5%, 65%, 1)" />
        <Text className="text-theme-neutrals-400 text-[11px]" numberOfLines={1}>{placeholder}</Text>
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: BUBBLE, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 84, alignItems: "center", gap: 2 }}>
      {!!note.gifUrl && <SmartImage source={{ uri: note.gifUrl }} style={{ width: 48, height: 32, borderRadius: 6 }} contentFit="cover" />}
      {!!note.text && <Text className="text-white text-[11px] text-center" numberOfLines={2}>{note.text}</Text>}
      {!note.text && !!note.song && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Ionicons name="musical-notes" size={11} color="#fff" />
          <Text className="text-white text-[11px]" numberOfLines={1} style={{ maxWidth: 62 }}>{note.song.title}</Text>
        </View>
      )}
      {!note.text && !note.song && !!note.location && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Ionicons name="location" size={11} color="#fff" />
          <Text className="text-white text-[11px]" numberOfLines={1} style={{ maxWidth: 62 }}>{note.location}</Text>
        </View>
      )}
    </View>
  );
}

/** Share of the 24 hours a note has left, 0..1. */
function useNoteLeft(note: Note | null): number {
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
function NoteRing({ left }: { left: number }) {
  const side = RING - RING_STROKE;
  const r = RING_R;
  const perimeter = 4 * (side - 2 * r) + 2 * Math.PI * r;
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(sweep, { toValue: left, duration: 700, useNativeDriver: false }).start();
  }, [left, sweep]);
  const offset = sweep.interpolate({ inputRange: [0, 1], outputRange: [perimeter, 0] });
  return (
    <Svg width={RING} height={RING} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
      <Rect x={RING_STROKE / 2} y={RING_STROKE / 2} width={side} height={side} rx={r} ry={r}
        fill="none" stroke="hsla(0, 0%, 100%, 0.14)" strokeWidth={RING_STROKE} />
      <AnimatedRect x={RING_STROKE / 2} y={RING_STROKE / 2} width={side} height={side} rx={r} ry={r}
        fill="none" stroke="hsla(0, 0%, 100%, 0.92)" strokeWidth={RING_STROKE} strokeLinecap="round"
        strokeDasharray={`${perimeter} ${perimeter}`} strokeDashoffset={offset} />
    </Svg>
  );
}

/**
 * One note in the row. Every tile is the same size: a bubble slot on top
 * (empty when there are no words), the face inside its countdown ring, and
 * the name. A GIF note shows the GIF in place of the face.
 */
function NoteTile({ author, note, label, onPress, placeholder }: { author: StoryAuthor; note: Note | null; label: string; onPress: () => void; placeholder: string }) {
  const avatar = getAvatarUrl(author.avatarImageUrl, 56);
  const left = useNoteLeft(note);
  const gif = note?.gifUrl || null;
  const showBubble = !note || !!note.text || (!gif && (!!note.song || !!note.location));
  return (
    <Pressable onPress={onPress} style={{ width: 84, alignItems: "center", gap: 4, paddingTop: 2 }} accessibilityRole="button" accessibilityLabel={label}>
      <View style={{ height: 36, justifyContent: "flex-end", alignItems: "center" }}>
        {showBubble ? <NoteBubble note={note && gif ? { ...note, gifUrl: null } : note} placeholder={placeholder} /> : null}
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

function SongLine({ song, autoPlay, playToken = 0 }: { song: StorySong; autoPlay?: boolean; playToken?: number }) {
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
  // A tap on the note's words plays the song: the autoplay above can fire
  // before the file has loaded, and the words are what people tap.
  useEffect(() => {
    if (!playToken) return;
    try { if (player.playing) { setPlaying(true); return; } } catch { /* not loaded */ }
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToken]);
  const toggle = () => {
    if (playing) { try { player.pause(); } catch { /* gone */ } setPlaying(false); return; }
    start();
  };
  return (
    <TouchableOpacity onPress={toggle} activeOpacity={0.8} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: FIELD, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
      {song.artworkUrl
        ? <SmartImage source={{ uri: song.artworkUrl }} style={{ width: 36, height: 36, borderRadius: 6 }} contentFit="cover" />
        : <View style={{ width: 36, height: 36, borderRadius: 6, backgroundColor: BUBBLE, alignItems: "center", justifyContent: "center" }}><Ionicons name="musical-notes" size={16} color="#fff" /></View>}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-white text-[13px] font-semibold" numberOfLines={1}>{song.title}</Text>
        {!!song.artist && <Text className="text-theme-neutrals-400 text-[12px]" numberOfLines={1}>{song.artist}</Text>}
      </View>
      <Ionicons name={playing ? "pause" : "play"} size={16} color="#fff" />
    </TouchableOpacity>
  );
}

function PillButton({ icon, label, onPress, primary, disabled }: { icon?: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={{ flexGrow: primary ? 1 : 0, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: primary ? "#fff" : FIELD }}>
        {icon && <Ionicons name={icon} size={16} color={primary ? "#000" : "#fff"} />}
        <Text style={{ color: primary ? "#000" : "#fff", fontSize: 14, fontWeight: "600" }}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

function NoteComposer({ mine, onClose }: { mine: Note | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState(mine?.text ?? "");
  const [location, setLocation] = useState(mine?.location ?? "");
  const [showPlace, setShowPlace] = useState(!!mine?.location);
  const [gifUrl, setGifUrl] = useState<string | null>(mine?.gifUrl ?? null);
  const [song, setSong] = useState<StorySong | null>(mine?.song ?? null);
  const [gifOpen, setGifOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const failed = () => toastError(t("notes.failed", { defaultValue: "Your note didn't go up. Try again." }));

  const save = useMutation({
    mutationFn: (input: NoteInput) => putNote(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: NOTES_QUERY_KEY }); toastSuccess(t("notes.shared", { defaultValue: "Your note is up for 24 hours" })); onClose(); },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: deleteNote,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: NOTES_QUERY_KEY }); onClose(); },
    onError: failed,
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
    <View style={{ gap: 12 }}>
      <View>
        <TextInput
          value={text}
          onChangeText={(v) => setText(v.replace(/\n/g, " "))}
          maxLength={NOTE_TEXT_MAX}
          autoFocus
          multiline
          blurOnSubmit
          returnKeyType="done"
          onSubmitEditing={share}
          placeholder={t("notes.placeholder", { defaultValue: "Share a thought…" })}
          placeholderTextColor="hsla(240, 4%, 46%, 1)"
          style={{ backgroundColor: FIELD, borderRadius: 16, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, color: "#fff", fontSize: 16, textAlign: "center", minHeight: 64 }}
        />
        <Text className="text-theme-neutrals-500 text-[11px]" style={{ position: "absolute", right: 12, bottom: 4 }}>{NOTE_TEXT_MAX - text.length}</Text>
      </View>

      {!!gifUrl && (
        <View style={{ alignSelf: "center" }}>
          <SmartImage source={{ uri: gifUrl }} style={{ width: 160, height: 120, borderRadius: 12 }} contentFit="contain" />
          <TouchableOpacity onPress={() => setGifUrl(null)} accessibilityLabel={t("notes.removeGif", { defaultValue: "Remove GIF" })} style={{ position: "absolute", right: 4, top: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 12, padding: 4 }}>
            <Ionicons name="close" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      )}
      {!!song && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}><SongLine song={song} /></View>
          <TouchableOpacity onPress={() => setSong(null)} accessibilityLabel={t("notes.removeSong", { defaultValue: "Remove song" })} style={{ padding: 8 }}>
            <Ionicons name="close" size={18} color="hsla(240, 5%, 65%, 1)" />
          </TouchableOpacity>
        </View>
      )}
      {showPlace && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: FIELD, borderRadius: 12, paddingHorizontal: 12 }}>
          <Ionicons name="location-outline" size={16} color="hsla(240, 5%, 65%, 1)" />
          <TextInput
            value={location}
            onChangeText={setLocation}
            maxLength={NOTE_LOCATION_MAX}
            placeholder={t("notes.placePlaceholder", { defaultValue: "Where are you?" })}
            placeholderTextColor="hsla(240, 4%, 46%, 1)"
            style={{ flex: 1, height: 40, color: "#fff", fontSize: 14 }}
          />
          <TouchableOpacity onPress={() => { setLocation(""); setShowPlace(false); }} accessibilityLabel={t("notes.removePlace", { defaultValue: "Remove place" })}>
            <Ionicons name="close" size={16} color="hsla(240, 5%, 65%, 1)" />
          </TouchableOpacity>
        </View>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
        <PillButton icon="musical-notes-outline" label={t("notes.song", { defaultValue: "Song" })} onPress={() => setSoundOpen(true)} />
        <PillButton label="GIF" onPress={() => setGifOpen(true)} />
        {!showPlace && <PillButton icon="location-outline" label={t("notes.place", { defaultValue: "Place" })} onPress={() => setShowPlace(true)} />}
      </View>

      <Text className="text-theme-neutrals-500 text-[12px] text-center">{t("notes.who", { defaultValue: "People who follow you can see it for 24 hours." })}</Text>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {!!mine && <PillButton label={t("notes.delete", { defaultValue: "Delete note" })} onPress={() => remove.mutate()} disabled={remove.isPending} />}
        <PillButton primary label={t("notes.share", { defaultValue: "Share" })} onPress={share} disabled={empty || save.isPending} />
      </View>

      <GifPicker
        visible={gifOpen}
        onClose={() => setGifOpen(false)}
        onPick={(url) => {
          setGifOpen(false);
          if (isNoteGif(url)) setGifUrl(url);
          else toastError(t("notes.gifHost", { defaultValue: "Pick a GIF from the GIF tab for notes." }));
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
 * The Notes sheet: write, change or delete your note at the top, and below it
 * the notes of people you follow (tap one to see it, hear the song and
 * message them). Opened from the + in Messages and from a chat's + sheet.
 */
/** Reply to a note: a message box that sends straight into your chat with them. */
function NoteReply({ note, name, onSend }: { note: Note; name: string; onSend: (text: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const send = () => {
    const reply = text.trim();
    if (!reply) return;
    // The note's words ride along, so the chat shows what was answered.
    onSend(note.text ? `📝 “${note.text}”\n${reply}` : reply);
  };
  const label = t("notes.replyTo", { defaultValue: "Reply to {{name}}…", name });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        maxLength={1000}
        placeholder={label}
        accessibilityLabel={label}
        placeholderTextColor="hsla(240, 5%, 55%, 1)"
        returnKeyType="send"
        onSubmitEditing={send}
        style={{ flex: 1, minHeight: 44, borderRadius: 22, paddingHorizontal: 16, backgroundColor: FIELD, color: "#fff", fontSize: 15, borderWidth: 1, borderColor: "hsla(0, 0%, 100%, 0.1)" }}
      />
      <TouchableOpacity
        onPress={send}
        disabled={!text.trim()}
        accessibilityRole="button"
        accessibilityLabel={t("notes.send", { defaultValue: "Send" })}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", opacity: text.trim() ? 1 : 0.4 }}
      >
        <Ionicons name="send" size={18} color="#000" />
      </TouchableOpacity>
    </View>
  );
}

/** The words of a note in a chat bubble; with a song, a tap plays it. */
function NoteTextBubble({ text, onPress }: { text: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ alignSelf: "center", maxWidth: "100%" }} accessibilityRole={onPress ? "button" : "text"}>
      <View style={{ backgroundColor: BUBBLE, borderRadius: 20, borderBottomLeftRadius: 6, paddingHorizontal: 16, paddingVertical: 10 }}>
        <Text className="text-white text-[16px] font-semibold">{text}</Text>
      </View>
    </Pressable>
  );
}

export default function NotesSheet({ visible, onClose, onMessage }: { visible: boolean; onClose: () => void; onMessage: (a: StoryAuthor, reply?: string) => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const backdrop = useSheetBackdrop(visible && Platform.OS !== "android");
  const { data } = useQuery({ queryKey: NOTES_QUERY_KEY, queryFn: getNotes, staleTime: 60_000, enabled: visible });
  const [viewing, setViewing] = useState<NoteEntry | null>(null);
  const [playToken, setPlayToken] = useState(0);
  useEffect(() => { if (!visible) setViewing(null); }, [visible]);
  const mine = data?.mine?.note ?? null;
  const notes = data?.notes ?? [];
  const placeholder = t("notes.add", { defaultValue: "Note" });
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent statusBarTranslucent navigationBarTranslucent>
      <SheetBackdrop backdrop={backdrop} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
        <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1 }} />
        <View className="overflow-hidden rounded-t-[20px] border-t border-white/10 p-4" style={{ paddingBottom: insets.bottom + 16, maxHeight: "90%" }}>
          <DrawerSurface backdropBlurred={backdrop.blurred} />
          <Text className="text-white text-[15px] font-semibold text-center mb-3">
            {viewing ? nameOf(viewing.author) : t("notes.title", { defaultValue: "Notes" })}
          </Text>
          {viewing ? (
            <View style={{ gap: 14 }}>
              {!!viewing.note.gifUrl && <SmartImage source={{ uri: viewing.note.gifUrl }} style={{ width: "100%", height: 200, borderRadius: 12 }} contentFit="contain" />}
              {!!viewing.note.text && (
                <NoteTextBubble text={viewing.note.text} onPress={viewing.note.song ? () => setPlayToken((n) => n + 1) : undefined} />
              )}
              {!!viewing.note.song && <SongLine song={viewing.note.song} autoPlay playToken={playToken} />}
              {!!viewing.note.location && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
                  <Ionicons name="location-outline" size={14} color="hsla(240, 5%, 65%, 1)" />
                  <Text className="text-theme-neutrals-400 text-[13px]">{viewing.note.location}</Text>
                </View>
              )}
              <NoteReply key={viewing.note.id} note={viewing.note} name={nameOf(viewing.author)} onSend={(reply) => { const a = viewing.author; onClose(); onMessage(a, reply); }} />
              <PillButton label={t("notes.back", { defaultValue: "Back to notes" })} onPress={() => setViewing(null)} />
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {visible && <NoteComposer key={mine?.id ?? "new"} mine={mine} onClose={onClose} />}
              {notes.length > 0 && (
                <View style={{ gap: 6 }}>
                  <Text className="text-theme-neutrals-400 text-[12px] font-semibold">{t("notes.fromFollowing", { defaultValue: "From people you follow" })}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }} keyboardShouldPersistTaps="handled">
                    {notes.map((entry) => (
                      <NoteTile key={entry.note.id} author={entry.author} note={entry.note} label={nameOf(entry.author)} placeholder={placeholder} onPress={() => setViewing(entry)} />
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
