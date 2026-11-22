/**
 * Making a moment. Port of web's StoryCreator, on the phone's own camera:
 *
 *   1. Camera (photo, or a clip up to 60 s) or a pick from Photos.
 *   2. The 9:16 stage: add words (drag them, colour, box), mute a clip,
 *      pick who sees it, then Share. Sharing runs in the background.
 *
 * Words are drawn into the photo (or onto a layer over the clip) with Skia;
 * an install without Skia sends them as the caption instead.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import Icon from "../ui/Icon";
import MentionSuggestions from "../common/MentionSuggestions";
import { DarkRoomProvider } from "../../context/ThemeContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { optionalSkia } from "../../libs/skia";
import { toastError } from "../../libs/toast";
import { mentionSearch, type MentionUser } from "../../services/mention.service";
import { getStoryShelf, STORY_LIFETIMES, type StoryAudience, type StoryLifetime } from "../../services/stories.service";
import type { StoryRemixSource } from "../../store/stories.store";
import { CAPTION_FONTS, captionFonts, captionFontStyle } from "./caption-fonts";
import { shareMoment } from "./story-upload";
import type { TextLayer } from "./story-compose";

const AUDIENCE_KEY = "riftn.stories.audience";
const COLORS = ["#ffffff", "#000000", "#ff5c7a", "#ffb34d", "#ffe14d", "#5ce08a", "#4dc3ff", "#a391fc"];
const MAX_SECONDS = 60;
const MAX_MENTIONS = 10;

type Picked = { kind: "photo" | "video"; uri: string; mimeType: string; width: number; height: number; duration: number };

const compose = optionalSkia(() => require("./story-compose") as typeof import("./story-compose"));

export default function StoryCreator({ onClose, remixSource }: { onClose: () => void; remixSource?: StoryRemixSource }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<Picked | null>(null);
  const { data: storyCapabilities } = useQuery({
    queryKey: ["story-posting-capabilities"],
    queryFn: async () => getStoryShelf(false, "").then(({ supportsCustomAudience, supportsCustomLifetime, supportsPhotoDuration }) => ({ supportsCustomAudience, supportsCustomLifetime, supportsPhotoDuration })),
    staleTime: 60_000,
    retry: false,
  });
  const remixLabel = remixSource ? t("stories.remixing", { name: remixSource.name, defaultValue: "Remixing {{name}}'s moment" }) : undefined;

  const take = useCallback(
    async (from: "camera" | "library") => {
      try {
        const opts: ImagePicker.ImagePickerOptions = {
          mediaTypes: ["images", "videos"],
          quality: 0.9,
          videoMaxDuration: MAX_SECONDS,
          allowsEditing: false,
        };
        if (from === "camera") {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            toastError(t("stories.cameraOff", { defaultValue: "Camera access is off. Turn it on in Settings, or pick from Photos." }));
            return;
          }
        }
        const res = from === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
        const a = res.assets?.[0];
        if (res.canceled || !a) return;
        const video = a.type === "video";
        setPicked({
          kind: video ? "video" : "photo",
          uri: a.uri,
          mimeType: a.mimeType || (video ? "video/mp4" : "image/jpeg"),
          width: a.width || 1080,
          height: a.height || 1920,
          duration: (a.duration || 0) / 1000,
        });
      } catch (e: any) {
        toastError(e?.message || t("stories.pickFailed", { defaultValue: "Couldn't open that. Try another." }));
      }
    },
    [t],
  );

  return (
    <DarkRoomProvider>
      <View className="dark-surface" style={styles.root}>
        {picked ? (
          <Editor picked={picked} onBack={() => setPicked(null)} onClose={onClose} remixSourceId={remixSource?.id} remixLabel={remixLabel} customLifetime={!!storyCapabilities?.supportsCustomLifetime} customAudience={!!storyCapabilities?.supportsCustomAudience} customPhotoDuration={!!storyCapabilities?.supportsPhotoDuration} />
        ) : (
          <View style={[styles.start, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.topRow}>
              <TouchableOpacity onPress={onClose} style={styles.iconBtn} accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
                <Icon name="X" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.startBody}>
              <Text style={styles.startTitle}>{remixLabel ?? t("stories.newMoment", { defaultValue: "New moment" })}</Text>
              <Text style={styles.startSub}>{t("stories.startSub", { defaultValue: "A photo or a clip up to 60 seconds. It stays up for 24 hours." })}</Text>
              <TouchableOpacity style={[styles.bigBtn, styles.bigBtnMain]} onPress={() => void take("camera")}>
                <Icon name="Camera" size={22} color="#000" />
                <Text style={[styles.bigBtnText, { color: "#000" }]}>{t("stories.openCamera", { defaultValue: "Camera" })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bigBtn} onPress={() => void take("library")}>
                <Icon name="Images" size={22} color="#fff" />
                <Text style={styles.bigBtnText}>{t("stories.pick", { defaultValue: "Pick from device" })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </DarkRoomProvider>
  );
}

function Editor({ picked, onBack, onClose, remixSourceId, remixLabel, customLifetime, customAudience, customPhotoDuration }: {
  picked: Picked;
  onBack: () => void;
  onClose: () => void;
  remixSourceId?: string;
  remixLabel?: string;
  customLifetime: boolean;
  customAudience: boolean;
  customPhotoDuration: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { width: winW, height: winH } = useWindowDimensions();
  // The 9:16 stage, as large as fits between the top and bottom bars.
  const stageH = Math.min(winH - insets.top - insets.bottom - 96, (winW * 16) / 9);
  const stageW = (stageH * 9) / 16;

  const [layers, setLayers] = useState<TextLayer[]>([]);
  const [editing, setEditing] = useState<TextLayer | null>(null);
  const [mentionTarget, setMentionTarget] = useState<{ layer?: TextLayer } | null>(null);
  const [muted, setMuted] = useState(false);
  const isPhoto = picked.kind === "photo";
  const maxSeconds = isPhoto ? MAX_SECONDS : Math.min(MAX_SECONDS, picked.duration || MAX_SECONDS);
  const [playbackSeconds, setPlaybackSeconds] = useState(isPhoto ? 5 : Math.ceil(maxSeconds));
  const [choosingPlayback, setChoosingPlayback] = useState(false);
  const playbackLabel = t("liveStudio.fields.duration", { defaultValue: "Seconds on screen" });
  const [audience, setAudience] = useState<StoryAudience>("everyone");
  const [lifetime, setLifetime] = useState<StoryLifetime>(24);
  const [choosingLifetime, setChoosingLifetime] = useState(false);
  const lifetimeLabel = t("stories.lifetime", { defaultValue: "Story duration" });
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(AUDIENCE_KEY)
      .then((v) => (v === "followers" || v === "everyone") && setAudience(v))
      .catch(() => {});
  }, []);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [pickingAudiencePerson, setPickingAudiencePerson] = useState(false);
  const [audiencePeople, setAudiencePeople] = useState<MentionUser[]>([]);
  const restrictPeople = audience === "selected" || audience === "except";
  const audienceLabels = {
    everyone: t("stories.everyone", { defaultValue: "Everyone" }),
    followers: t("stories.followersOnly", { defaultValue: "Followers" }),
    selected: t("stories.selectedPeople", { defaultValue: "Only selected people" }),
    except: t("stories.hideFromPeople", { defaultValue: "Hide from selected people" }),
  };
  const player = useVideoPlayer(picked.kind === "video" ? picked.uri : null, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });
  React.useEffect(() => {
    if (picked.kind !== "video") return;
    try {
      player.muted = muted;
    } catch {
      /* not loaded yet */
    }
  }, [player, muted, picked.kind]);

  React.useEffect(() => {
    if (isPhoto || (picked.duration > 0 && playbackSeconds >= picked.duration)) return;
    const sub = player.addListener("timeUpdate", ({ currentTime }) => {
      if (currentTime >= playbackSeconds) player.currentTime = 0;
    });
    return () => sub.remove();
  }, [player, isPhoto, picked.duration, playbackSeconds]);

  const startText = () =>
    setEditing({ id: `${Date.now()}`, text: "", x: 0.5, y: 0.42, size: 0.075, color: "#ffffff", box: false });
  const commitText = () => {
    if (!editing) return;
    const keep = editing.text.trim();
    setLayers((ls) => {
      const rest = ls.filter((l) => l.id !== editing.id);
      return keep ? [...rest, editing] : rest;
    });
    setEditing(null);
  };
  const selectMention = (user: MentionUser) => {
    const address = user.address.toLowerCase();
    const layer = mentionTarget?.layer ?? {
      id: `mention-${address}`, x: 0.5, y: 0.6, size: 0.06, color: "#ffffff", box: true,
    };
    setLayers((current) => {
      if (current.some((l) => l.id !== layer.id && l.mentionAddress === address)) return current;
      return [...current.filter((l) => l.id !== layer.id), { ...layer, text: `@${user.username}`, mentionAddress: address }];
    });
    setMentionTarget(null);
  };

  const share = async () => {
    if (busy || (restrictPeople && !audiencePeople.length)) return;
    setBusy(true);
    try {
      const visible = layers.filter((l) => l.text.trim());
      const words = visible.map((l) => l.text.trim()).join(" ");
      let uri = picked.uri;
      let mimeType = picked.mimeType;
      let overlayUri: string | null = null;
      let caption: string | undefined;
      if (compose) {
        if (picked.kind === "photo") {
          uri = await compose.composePhoto(picked.uri, visible);
          mimeType = "image/jpeg";
        } else {
          overlayUri = await compose.composeOverlay(visible);
        }
      } else if (words) {
        caption = words.slice(0, 300);
      }
      shareMoment(
        {
          kind: picked.kind,
          uri,
          mimeType,
          overlayUri,
          preview: picked.kind === "photo" ? uri : "",
          fields: {
            audience,
            audienceAddresses: restrictPeople ? audiencePeople.map(user => user.address) : undefined,
            expiresInHours: customLifetime ? lifetime : undefined,
            muted: picked.kind === "video" ? muted : false,
            caption,
            remixSourceId,
            mentions: picked.kind === "photo" || overlayUri ? compose?.mentionBoxes(visible) : undefined,
            ...(isPhoto ? { photoDurationSeconds: customPhotoDuration ? playbackSeconds : undefined } : { trimStart: 0, trimEnd: Math.min(playbackSeconds, maxSeconds) }),
          },
        },
        () => void queryClient.invalidateQueries({ queryKey: ["story-shelf"] }),
      );
      onClose();
    } catch (e: any) {
      setBusy(false);
      toastError(e?.message || t("stories.shareFailed", { defaultValue: "Your moment didn't go up. Tap your tile to try again." }));
    }
  };

  const fit = picked.width > picked.height * 1.34 ? "contain" : "cover";

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 10 }}>
      <View style={[styles.stage, { width: stageW, height: stageH }]}>
        {picked.kind === "video" ? (
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} />
        ) : (
          <>
            <Image source={{ uri: picked.uri }} style={[StyleSheet.absoluteFill, { opacity: 0.6 }]} contentFit="cover" blurRadius={24} />
            <Image source={{ uri: picked.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          </>
        )}
        {layers
          .filter((l) => l.id !== editing?.id)
          .map((l) => (
            <DraggableText
              key={l.id}
              layer={l}
              stageW={stageW}
              stageH={stageH}
              onMove={(x, y) => setLayers((ls) => ls.map((x0) => (x0.id === l.id ? { ...x0, x, y } : x0)))}
              onTap={() => l.mentionAddress ? setMentionTarget({ layer: l }) : setEditing(l)}
            />
          ))}

        <View style={styles.stageTop}>
          <TouchableOpacity className="dark-surface" onPress={onBack} style={[styles.iconBtn, styles.mediaBtn]} accessibilityLabel={t("stories.back", { defaultValue: "Back" })}>
            <Icon name="ChevronLeft" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity className="dark-surface" onPress={onClose} style={[styles.iconBtn, styles.mediaBtn, styles.dismissBtn]} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
            <Icon name="X" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            {remixLabel ? <Text style={styles.remixLabel} numberOfLines={1}>{remixLabel}</Text> : null}
          </View>
          <View style={styles.tools}>
            {maxSeconds > 1 && (!isPhoto || customPhotoDuration) && (
              <TouchableOpacity className="dark-surface" onPress={() => setChoosingPlayback(true)}
                style={[styles.iconBtn, styles.mediaBtn]} accessibilityRole="button" accessibilityLabel={playbackLabel}>
                <Icon name="Clock" size={20} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity className="dark-surface" onPress={startText} style={[styles.iconBtn, styles.mediaBtn]} accessibilityLabel={t("stories.text", { defaultValue: "Text" })}>
              <Icon name="Type" size={20} color="#fff" />
            </TouchableOpacity>
            {compose && layers.filter((layer) => layer.mentionAddress).length < MAX_MENTIONS ? (
              <TouchableOpacity className="dark-surface" onPress={() => setMentionTarget({})} style={[styles.iconBtn, styles.mediaBtn]} accessibilityRole="button"
                accessibilityLabel={t("upload.studio.mention", { defaultValue: "Mention" })}>
                <Icon name="AtSign" size={20} color="#fff" />
              </TouchableOpacity>
            ) : null}
            {picked.kind === "video" ? (
              <TouchableOpacity className="dark-surface" onPress={() => setMuted((m) => !m)} style={[styles.iconBtn, styles.mediaBtn]} accessibilityLabel={t("stories.mute", { defaultValue: "Sound" })}>
                <Icon name={muted ? "VolumeX" : "Volume2"} size={20} color="#fff" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity onPress={() => setAudienceOpen(true)} style={styles.chip}>
          <Icon name={audience === "everyone" ? "Globe" : "Users"} size={15} color="#fff" />
          <Text style={styles.chipText}>
            {audienceLabels[audience]}
          </Text>
        </TouchableOpacity>
        {customLifetime ? (
          <TouchableOpacity onPress={() => setChoosingLifetime(true)} style={styles.chip} accessibilityRole="button" accessibilityLabel={`${lifetimeLabel}, ${lifetime}h`}>
            <Text style={styles.chipText}>{lifetime}h</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.chip}><Text style={styles.chipText}>24h</Text></View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => void share()} style={[styles.shareBtn, busy && { opacity: 0.6 }]} disabled={busy || (restrictPeople && !audiencePeople.length)}>
          <Text style={styles.shareText}>{t("stories.share", { defaultValue: "Share" })}</Text>
        </TouchableOpacity>
      </View>

      {audienceOpen && !pickingAudiencePerson && (
        <View style={styles.lifetimeOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAudienceOpen(false)} accessible={false} />
          <ScrollView style={[styles.textTools, { maxHeight: "75%" }]} contentContainerStyle={{ gap: 8, paddingBottom: insets.bottom + 16 }} accessibilityViewIsModal>
            {(Object.keys(audienceLabels) as StoryAudience[]).filter(mode => customAudience || mode === "everyone" || mode === "followers").map(mode => (
              <TouchableOpacity key={mode} style={styles.chip} accessibilityRole="radio" accessibilityState={{ checked: mode === audience }}
                onPress={() => {
                  if (mode !== audience) setAudiencePeople([]);
                  setAudience(mode);
                  if (mode === "followers" || mode === "everyone") AsyncStorage.setItem(AUDIENCE_KEY, mode).catch(() => {});
                }}>
                {mode === audience && <Icon name="Check" size={16} color="#fff" />}
                <Text style={styles.chipText}>{audienceLabels[mode]}</Text>
              </TouchableOpacity>
            ))}
            {restrictPeople && <>
              {audiencePeople.map(user => (
                <TouchableOpacity key={user.address} style={styles.chip} onPress={() => setAudiencePeople(current => current.filter(item => item.address !== user.address))}>
                  <Text style={styles.chipText}>@{user.username} ×</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.chip} disabled={audiencePeople.length >= 50} onPress={() => setPickingAudiencePerson(true)}>
                <Icon name="Search" size={16} color="#fff" /><Text style={styles.chipText}>{t("common.search", { defaultValue: "Search" })}</Text>
              </TouchableOpacity>
            </>}
            <TouchableOpacity style={styles.chip} onPress={() => setAudienceOpen(false)}>
              <Text style={styles.chipText}>{t("common.done", { defaultValue: "Done" })}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}
      {pickingAudiencePerson && (
        <MentionSheet title={audienceLabels[audience]} excluded={audiencePeople.map(user => user.address.toLowerCase())}
          onSelect={user => { setAudiencePeople(current => [...current, user]); setPickingAudiencePerson(false); }}
          onClose={() => setPickingAudiencePerson(false)} bottom={insets.bottom} />
      )}
      {choosingPlayback && (
        <View style={styles.lifetimeOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setChoosingPlayback(false)} accessible={false} />
          <View style={[styles.textTools, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
            <View style={styles.textRow}>
              <Text style={[styles.chipText, { flex: 1 }]}>{playbackLabel} · {playbackSeconds}s</Text>
              <TouchableOpacity onPress={() => setChoosingPlayback(false)} style={styles.chip} accessibilityRole="button">
                <Text style={styles.chipText}>{t("common.done", { defaultValue: "Done" })}</Text>
              </TouchableOpacity>
            </View>
            <Slider style={{ width: "100%", height: 40 }} accessibilityLabel={playbackLabel}
              minimumValue={1} maximumValue={Math.ceil(maxSeconds)} step={1} value={playbackSeconds}
              minimumTrackTintColor="#ffffff" maximumTrackTintColor="#888888" thumbTintColor="#ffffff"
              onValueChange={setPlaybackSeconds} />
          </View>
        </View>
      )}

      {choosingLifetime && (
        <View style={styles.lifetimeOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setChoosingLifetime(false)} accessible={false} />
          <View style={[styles.textTools, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
            <View style={styles.textRow}>
              <Text style={[styles.chipText, { flex: 1 }]}>{lifetimeLabel}</Text>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setChoosingLifetime(false)} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
                <Icon name="X" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.textRow}>
              {STORY_LIFETIMES.map((hours) => (
                <TouchableOpacity key={hours} style={[styles.chip, lifetime === hours && styles.chipOn]}
                  accessibilityRole="button" accessibilityState={{ selected: lifetime === hours }}
                  onPress={() => { setLifetime(hours); setChoosingLifetime(false); }}>
                  <Text style={styles.chipText}>{hours}h</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {editing ? (
        <TextSheet
          layer={editing}
          onChange={setEditing}
          onDone={commitText}
          stageW={stageW}
          bottom={insets.bottom}
        />
      ) : null}
      {mentionTarget ? (
        <MentionSheet
          layer={mentionTarget.layer}
          excluded={layers.flatMap((layer) => layer.mentionAddress && layer.id !== mentionTarget.layer?.id ? [layer.mentionAddress] : [])}
          onSelect={selectMention}
          onClose={() => setMentionTarget(null)}
          onRemove={() => {
            setLayers((current) => current.filter((layer) => layer.id !== mentionTarget.layer?.id));
            setMentionTarget(null);
          }}
          bottom={insets.bottom}
        />
      ) : null}
    </View>
  );
}

function MentionSheet({ title, layer, excluded, onSelect, onClose, onRemove, bottom }: {
  title?: string;
  layer?: TextLayer;
  excluded: string[];
  onSelect: (user: MentionUser) => void;
  onClose: () => void;
  onRemove?: () => void;
  bottom: number;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const query = input.trim().replace(/^@/, "");
  const debounced = useDebouncedValue(query, 220);
  const { data: users = [], isFetching } = useQuery({
    queryKey: ["story-mention-people", debounced],
    queryFn: () => mentionSearch(debounced),
    enabled: query === debounced && debounced.length > 0,
    staleTime: 30_000,
  });
  const suggestions = users.filter((user) => user.username && /^0x[0-9a-f]{40}$/i.test(user.address) && !excluded.includes(user.address.toLowerCase()));
  const loading = query !== debounced || isFetching;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.lifetimeOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
      <View style={[styles.textTools, { paddingBottom: bottom + 16 }]} accessibilityViewIsModal>
        <View style={styles.textRow}>
          <Text style={[styles.chipText, { flex: 1 }]}>{title ?? layer?.text ?? t("upload.studio.mention", { defaultValue: "Mention" })}</Text>
          {layer ? (
            <TouchableOpacity style={styles.chip} onPress={onRemove} accessibilityRole="button">
              <Text style={styles.chipText}>{t("common.remove", { defaultValue: "Remove" })}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.iconBtn} onPress={onClose} accessibilityRole="button"
            accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
            <Icon name="X" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <TextInput autoFocus value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false}
          placeholder={t("common.search", { defaultValue: "Search" })} placeholderTextColor="rgba(255,255,255,0.55)"
          keyboardAppearance="dark" style={styles.mentionInput} />
        <MentionSuggestions visible={!!query && (loading || suggestions.length > 0)}
          suggestions={loading ? [] : suggestions} loading={loading} onSelect={onSelect} />
        {query && !loading && suggestions.length === 0 ? (
          <Text style={styles.chipText}>{t("follow.noResults", { defaultValue: "No results found" })}</Text>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function DraggableText({
  layer,
  stageW,
  stageH,
  onMove,
  onTap,
}: {
  layer: TextLayer;
  stageW: number;
  stageH: number;
  onMove: (x: number, y: number) => void;
  onTap: () => void;
}) {
  const start = useRef({ x: layer.x, y: layer.y });
  // PanResponder keeps cumulative movement for the lifetime of a gesture.
  // The parent updates the text layer on every move, including its callbacks.
  const latest = useRef({ layer, onMove, onTap });
  latest.current = { layer, onMove, onTap };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = { x: latest.current.layer.x, y: latest.current.layer.y };
        },
        onPanResponderMove: (_e, g) => {
          const x = Math.min(0.95, Math.max(0.05, start.current.x + g.dx / stageW));
          const y = Math.min(0.95, Math.max(0.05, start.current.y + g.dy / stageH));
          latest.current.onMove(x, y);
        },
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < 4 && Math.abs(g.dy) < 4) latest.current.onTap();
        },
      }),
    [stageW, stageH],
  );
  const fontSize = layer.size * stageW;
  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}
    >
      <View {...pan.panHandlers} accessible accessibilityRole="button" accessibilityLabel={layer.text} onAccessibilityTap={onTap}
        style={{ transform: [
          { translateX: (layer.x - 0.5) * stageW },
          { translateY: (layer.y - 0.5) * stageH },
          { rotate: `${layer.rotation ?? 0}deg` },
        ] }}
      >
        <Text style={textStyle(layer, fontSize)}>{layer.text}</Text>
      </View>
    </View>
  );
}

function textStyle(layer: TextLayer, fontSize: number) {
  return {
    color: layer.color,
    fontSize,
    lineHeight: fontSize * 1.18,
    ...captionFontStyle(layer.font),
    textAlign: "center" as const,
    paddingHorizontal: fontSize * 0.32,
    borderRadius: fontSize * 0.28,
    overflow: "hidden" as const,
    ...(layer.box
      ? { backgroundColor: layer.color.toLowerCase() === "#ffffff" ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.92)" }
      : { textShadowColor: "rgba(0,0,0,0.45)", textShadowRadius: fontSize * 0.35 }),
  };
}

function TextSheet({
  layer,
  onChange,
  onDone,
  stageW,
  bottom,
}: {
  layer: TextLayer;
  onChange: (l: TextLayer) => void;
  onDone: () => void;
  stageW: number;
  bottom: number;
}) {
  const { t } = useTranslation();
  const [fontsOpen, setFontsOpen] = useState(false);
  const font = layer.font ?? "classic";
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={StyleSheet.absoluteFill}>
      <Pressable style={styles.textBack} onPress={onDone}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 16 }}>
          <TextInput
            autoFocus
            multiline
            value={layer.text}
            onChangeText={(text) => onChange({ ...layer, text: text.slice(0, 200) })}
            placeholder={t("stories.typeSomething", { defaultValue: "Type something" })}
            placeholderTextColor="rgba(255,255,255,0.6)"
            keyboardAppearance="dark"
            style={[textStyle(layer, layer.size * stageW), { minWidth: 120, maxWidth: stageW, transform: [{ rotate: `${layer.rotation ?? 0}deg` }] }]}
          />
        </View>
        <Pressable onPress={() => {}} style={[styles.textTools, { paddingBottom: bottom + 10 }]}>
          <View style={styles.swatches}>
            {COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => onChange({ ...layer, color: c })}
                style={[styles.swatch, { backgroundColor: c }, layer.color === c && styles.swatchOn]}
              />
            ))}
          </View>
          <View style={[styles.textRow, { flexWrap: "wrap" }]}>
            <TouchableOpacity onPress={() => onChange({ ...layer, box: !layer.box })} style={styles.chip}>
              <Text style={styles.chipText}>{layer.box ? t("stories.boxOn", { defaultValue: "Box on" }) : t("stories.boxOff", { defaultValue: "Box off" })}</Text>
            </TouchableOpacity>
            {compose && (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("dmVideo.rotate", { defaultValue: "Rotate" })}
                accessibilityValue={{ text: `${layer.rotation ?? 0}°` }} style={styles.chip}
                onPress={() => onChange({ ...layer, rotation: ((layer.rotation ?? 0) + 45) % 360 })}>
                <Icon name="RotateCw" size={16} color="#fff" />
                <Text style={styles.chipText}>{layer.rotation ?? 0}°</Text>
              </TouchableOpacity>
            )}
            {compose && (
              <TouchableOpacity
                accessibilityRole="button" accessibilityLabel={t("stories.captionFont", { defaultValue: "Caption font" })}
                accessibilityState={{ expanded: fontsOpen }} style={styles.chip}
                onPress={() => { Keyboard.dismiss(); setFontsOpen(open => !open); }}
              >
                <Text style={[styles.chipText, captionFontStyle(font)]}>{t(`stories.captionStyles.${font}`, { defaultValue: CAPTION_FONTS[font].label })}</Text>
                <Icon name="ChevronDown" size={14} color="#fff" />
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onDone} style={styles.doneBtn} accessibilityLabel={t("common.done", { defaultValue: "Done" })}>
              <Icon name="Check" size={20} color="#000" />
            </TouchableOpacity>
          </View>
          {compose && fontsOpen && (
            <ScrollView style={{ maxHeight: Math.min(168, stageW / 2) }} keyboardShouldPersistTaps="always" nestedScrollEnabled>
              {captionFonts.map(id => (
                <TouchableOpacity
                  key={id} accessible accessibilityRole="radio" accessibilityState={{ checked: font === id }}
                  style={[styles.fontOption, font === id && styles.chipOn]}
                  onPress={() => { onChange({ ...layer, font: id }); setFontsOpen(false); }}
                >
                  <Text style={[styles.chipText, captionFontStyle(id)]}>{t(`stories.captionStyles.${id}`, { defaultValue: CAPTION_FONTS[id].label })}</Text>
                  {font === id && <Icon name="Check" size={16} color="#fff" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {compose && (
            <View style={styles.textRow}>
              <Text style={styles.chipText}>{t("articles.textSize", { defaultValue: "Text size" })}</Text>
              <Slider style={{ flex: 1 }} minimumValue={0.045} maximumValue={0.14} step={0.005} value={layer.size}
                accessibilityLabel={t("articles.textSize", { defaultValue: "Text size" })}
                minimumTrackTintColor="#fff" maximumTrackTintColor="#777" thumbTintColor="#fff"
                onValueChange={size => onChange({ ...layer, size })} />
            </View>
          )}
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  start: { flex: 1, paddingHorizontal: 20 },
  topRow: { flexDirection: "row" },
  startBody: { flex: 1, justifyContent: "center", gap: 12 },
  startTitle: { color: "#fff", fontSize: 26, fontWeight: "800" },
  startSub: { color: "rgba(255,255,255,0.7)", fontSize: 15, marginBottom: 18 },
  remixLabel: { color: "#fff", fontSize: 13, fontWeight: "600", marginHorizontal: 6, textShadowColor: "#000", textShadowRadius: 5 },
  bigBtn: {
    height: 58,
    borderRadius: 29,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.2)",
  },
  bigBtnMain: { backgroundColor: "#fff" },
  bigBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  mediaBtn: { backgroundColor: "#242427" },
  dismissBtn: { marginLeft: 8 },
  stage: { alignSelf: "center", borderRadius: 18, overflow: "hidden", backgroundColor: "#111" },
  stageTop: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", alignItems: "flex-start" },
  tools: { gap: 10 },
  bottomBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  chip: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  chipOn: { backgroundColor: "rgba(255,255,255,0.28)" },
  chipText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  shareBtn: { height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  shareText: { color: "#000", fontSize: 15, fontWeight: "800" },
  textBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  lifetimeOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  mentionInput: { minHeight: 44, borderRadius: 22, paddingHorizontal: 16, color: "#fff", backgroundColor: "rgba(255,255,255,0.1)" },
  textTools: { paddingHorizontal: 14, paddingTop: 12, gap: 10, backgroundColor: "#16161A", borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.18)" },
  swatches: { flexDirection: "row", gap: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "rgba(255,255,255,0.4)" },
  swatchOn: { borderColor: "#fff", transform: [{ scale: 1.15 }] },
  fontOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, paddingHorizontal: 12, borderRadius: 10 },
  textRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  doneBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
