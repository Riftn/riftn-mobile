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
  ActivityIndicator,
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
import { CameraView, useCameraPermissions } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import Icon from "../ui/Icon";
import MentionSuggestions from "../common/MentionSuggestions";
import { DarkRoomProvider, useAppTheme } from "../../context/ThemeContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { optionalSkia } from "../../libs/skia";
import { toastError, toastSuccess } from "../../libs/toast";
import { mentionSearch, type MentionUser } from "../../services/mention.service";
import { getStoryShelf, STORY_LIFETIMES, type StoryAudience, type StoryLifetime } from "../../services/stories.service";
import type { StoryRemixSource } from "../../store/stories.store";
import { CAPTION_FONTS, captionFonts, captionFontStyle } from "./caption-fonts";
import { shareMoment } from "./story-upload";
import { loadPostMoment, PostMomentError } from "./post-moment";
import type { TextLayer } from "./story-compose";
import { PHOTO_BACKDROPS, PHOTO_LOOKS, type PhotoBackdrop, type PhotoLook } from "./story-effects";

const AUDIENCE_KEY = "riftn.stories.audience";
/** The saved Close friends list, reused for "Only selected people". */
const CLOSE_FRIENDS_KEY = "riftn.stories.closeFriends";
/** Stickers are big glyph layers: emoji keep their colours, the shapes take the text colour. */
const STICKER_EMOJI = ["🔥", "😂", "😍", "🥳", "👀", "💯", "🎉", "❤️", "✨", "👏", "🙌", "😎", "🤯", "🫶", "🙏", "💀", "🚀", "⚡", "🌙", "☀️"];
const STICKER_SHAPES = ["→", "←", "↑", "↓", "↗", "↘", "➜", "○", "✓", "✗", "★", "♥", "!", "?"];
const COLORS = ["#ffffff", "#000000", "#ff5c7a", "#ffb34d", "#ffe14d", "#5ce08a", "#4dc3ff", "#a391fc"];
const MAX_SECONDS = 60;
/** Share button colours per theme, as on web (stories.css --st-acc / --st-acc2 / --st-btn-ink). */
const SHARE_COLORS: Partial<Record<string, { from: string; to: string; ink: string }>> = {
  hazy: { from: "#a391fc", to: "#f39bff", ink: "#170a2a" },
  osaka: { from: "#ff6fb1", to: "#7fe3e0", ink: "#1a0d18" },
  jungle: { from: "#9be15d", to: "#00e3ae", ink: "#0b1a0b" },
  war: { from: "#e8b04a", to: "#e8b04a", ink: "#1a1206" },
};
const MAX_MENTIONS = 10;

/** `postTokenId`: shared from one of your posts. A video one plays from the CDN and the server cuts it. */
type Picked = { kind: "photo" | "video"; uri: string; mimeType: string; width: number; height: number; duration: number; postTokenId?: number };

const compose = optionalSkia(() => require("./story-compose") as typeof import("./story-compose"));
const PhotoPreview = optionalSkia(() => (require("./StoryPhotoPreview") as typeof import("./StoryPhotoPreview")).default);

export default function StoryCreator({ onClose, remixSource, postTokenId }: { onClose: () => void; remixSource?: StoryRemixSource; postTokenId?: number }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<Picked | null>(null);
  const { data: storyCapabilities } = useQuery({
    queryKey: ["story-posting-capabilities"],
    queryFn: async () => getStoryShelf(false, "").then(({ supportsCustomAudience, supportsCustomLifetime, supportsPhotoDuration }) => ({ supportsCustomAudience, supportsCustomLifetime, supportsPhotoDuration })),
    staleTime: 60_000,
    retry: false,
  });
  const remixLabel = remixSource
    ? t("stories.remixing", { name: remixSource.name, defaultValue: "Remixing {{name}}'s moment" })
    : postTokenId != null ? t("stories.fromAPost", { defaultValue: "From a post" }) : undefined;

  // "Share to Moment": start in the editor with the post already in it.
  React.useEffect(() => {
    if (postTokenId == null) return;
    let alive = true;
    loadPostMoment(postTokenId)
      .then((m) => { if (alive) setPicked(m); })
      .catch((err) => {
        if (!alive) return;
        const reason = err instanceof PostMomentError ? err.reason : "load";
        toastError(reason === "gated"
          ? t("stories.postNotPublic", { defaultValue: "Only public posts can be shared to a Moment." })
          : reason === "kind"
            ? t("stories.postNotMedia", { defaultValue: "Only photo and video posts can be shared to a Moment." })
            : t("stories.pickFailed", { defaultValue: "Couldn't open that. Try another." }));
        onClose();
      });
    return () => { alive = false; };
  }, [postTokenId]); // eslint-disable-line react-hooks/exhaustive-deps

  const take = useCallback(
    async (from: "camera" | "library" | "video") => {
      try {
        const opts: ImagePicker.ImagePickerOptions = {
          mediaTypes: from === "video" ? ["videos"] : ["images", "videos"],
          quality: 0.9,
          videoMaxDuration: MAX_SECONDS,
          allowsEditing: false,
        };
        if (from !== "library") {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            toastError(t("stories.cameraOff", { defaultValue: "Camera access is off. Turn it on in Settings, or pick from Photos." }));
            return;
          }
        }
        const res = from !== "library" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
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
          <Editor picked={picked} onBack={() => (picked.postTokenId != null ? onClose() : setPicked(null))} onClose={onClose} remixSourceId={remixSource?.id} remixLabel={remixLabel} customLifetime={!!storyCapabilities?.supportsCustomLifetime} customAudience={!!storyCapabilities?.supportsCustomAudience} customPhotoDuration={!!storyCapabilities?.supportsPhotoDuration} />
        ) : postTokenId != null ? (
          <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}>
            <ActivityIndicator color="#fff" />
            <TouchableOpacity className="dark-surface" onPress={onClose} style={[styles.iconBtn, styles.darkGlass, { position: "absolute", top: insets.top + 8, left: 12 }]} accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
              <Icon name="X" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <CameraStart onClose={onClose} remixLabel={remixLabel} onPick={(from) => void take(from)} onPhoto={setPicked} />
        )}
      </View>
    </DarkRoomProvider>
  );
}


/**
 * Step 1, as on web: the camera fills a rounded stage, tap the shutter for a
 * photo, hold it for a clip (the phone's own recorder, up to 60 s), or pick
 * from Photos. Without camera access it says so and offers Photos.
 */
function CameraStart({ onClose, remixLabel, onPick, onPhoto }: {
  onClose: () => void;
  remixLabel?: string;
  onPick: (from: "camera" | "library" | "video") => void;
  onPhoto: (picked: Picked) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [taking, setTaking] = useState(false);
  const asked = useRef(false);

  React.useEffect(() => {
    if (!permission || permission.granted || asked.current || !permission.canAskAgain) return;
    asked.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  const on = !!permission?.granted && !failed;
  const snap = async () => {
    if (!cameraRef.current || !ready || taking) return;
    setTaking(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (photo?.uri) {
        onPhoto({ kind: "photo", uri: photo.uri, mimeType: "image/jpeg", width: photo.width || 1080, height: photo.height || 1920, duration: 0 });
      }
    } catch {
      onPick("camera");
    } finally {
      setTaking(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.camStage, { top: insets.top + 8, bottom: insets.bottom + 118 }]}>
        {on ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            mirror={facing === "front"}
            mode="picture"
            onCameraReady={() => setReady(true)}
            onMountError={() => setFailed(true)}
          />
        ) : permission ? (
          <View style={styles.camOff}>
            <Text style={styles.camOffTitle}>{t("stories.noCamera", { defaultValue: "Camera is off" })}</Text>
            <Text style={styles.camOffBody}>{t("stories.cameraOff", { defaultValue: "Camera access is off. Turn it on in Settings, or pick from Photos." })}</Text>
            <TouchableOpacity style={[styles.chip, styles.darkGlass]} onPress={() => onPick("library")} accessibilityRole="button">
              <Icon name="Images" size={16} color="#fff" />
              <Text style={styles.chipText}>{t("stories.pick", { defaultValue: "Pick from device" })}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={[styles.camTop, { top: insets.top + 20 }]}>
        <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
          <View style={[styles.iconBtn, styles.closeBtn]}>
            <Icon name="X" size={20} color="#fff" />
          </View>
        </TouchableOpacity>
        {remixLabel ? (
          <View style={[styles.chip, styles.darkGlass, { flexShrink: 1 }]}><Text style={styles.chipText} numberOfLines={1}>{remixLabel}</Text></View>
        ) : null}
        <View style={{ flex: 1 }} />
        {on ? (
          <TouchableOpacity onPress={() => { setReady(false); setFacing((f) => (f === "front" ? "back" : "front")); }} style={[styles.iconBtn, styles.darkGlass]}
            accessibilityRole="button" accessibilityLabel={t("stories.flip", { defaultValue: "Flip camera" })}>
            <Icon name="RefreshCw" size={20} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={[styles.camBottom, { bottom: insets.bottom + 22 }]}>
        <TouchableOpacity onPress={() => onPick("library")} style={[styles.iconBtn, styles.darkGlass]} accessibilityRole="button" accessibilityLabel={t("stories.pick", { defaultValue: "Pick from device" })}>
          <Icon name="Images" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      {on ? (
        <>
          <View style={[styles.camHint, { bottom: insets.bottom + 132 }]} pointerEvents="none">
            <Text style={styles.camHintText}>{t("stories.shutterHint", { defaultValue: "Tap for photo, hold for video" })}</Text>
          </View>
          {/* The ring is drawn by an inner view: a button with a grey fill of its
              own gets the theme's square button box from the control pass. */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => void snap()}
            onLongPress={() => onPick("video")}
            delayLongPress={260}
            style={[styles.shutterHit, { bottom: insets.bottom + 26 }]}
            accessibilityRole="button"
            accessibilityLabel={t("stories.shutter", { defaultValue: "Take a photo, or hold to film" })}
          >
            <View style={[styles.shutter, taking && styles.shutterDown]} />
          </TouchableOpacity>
        </>
      ) : null}
    </View>
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
  const audienceChosen = useRef(false);

  React.useEffect(() => {
    let active = true;
    AsyncStorage.getItem(AUDIENCE_KEY)
      .then((v) => {
        // Restore a default only until the author makes a choice in this editor.
        if (active && !audienceChosen.current && (v === "followers" || v === "everyone")) setAudience(v);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [pickingAudiencePerson, setPickingAudiencePerson] = useState(false);
  const [audiencePeople, setAudiencePeople] = useState<MentionUser[]>([]);
  const [closeFriends, setCloseFriends] = useState<MentionUser[]>([]);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [effectsOpen, setEffectsOpen] = useState(false);
  const [look, setLook] = useState<PhotoLook>("none");
  const [backdrop, setBackdrop] = useState<PhotoBackdrop>("blur");
  React.useEffect(() => {
    AsyncStorage.getItem(CLOSE_FRIENDS_KEY)
      .then((raw) => {
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) setCloseFriends(list.filter((u: MentionUser) => u && typeof u.address === "string").slice(0, 50));
      })
      .catch(() => {});
  }, []);
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

  const addSticker = (glyph: string) => {
    setLayers((ls) => [...ls, { id: `${Date.now()}`, text: glyph, x: 0.5, y: 0.45, size: 0.16, color: "#ffffff", box: false }]);
    setStickersOpen(false);
  };
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
      const written = layers.filter((l) => l.text.trim());
      const visible = written.filter((l) => !l.hidden);
      const words = visible.map((l) => l.text.trim()).join(" ");
      let uri = picked.uri;
      let mimeType = picked.mimeType;
      const fromPostVideo = picked.kind === "video" && picked.postTokenId != null;
      let overlayUri: string | null = null;
      let caption: string | undefined;
      if (compose) {
        if (picked.kind === "photo") {
          uri = await compose.composePhoto(picked.uri, visible, look, backdrop);
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
          uri: fromPostVideo ? "" : uri,
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
            postTokenId: picked.postTokenId,
            mentions: picked.kind === "photo" || overlayUri ? compose?.mentionBoxes(written) : undefined,
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
  const hiddenCount = layers.filter((l) => l.hidden && l.text.trim()).length;
  const { theme, isLight } = useAppTheme();
  const shareColors = isLight ? undefined : SHARE_COLORS[theme];

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 10 }}>
      <View style={[styles.stage, { width: stageW, height: stageH }]}>
        {picked.kind === "video" ? (
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} />
        ) : (
          <>
            <Image source={{ uri: picked.uri }} style={[StyleSheet.absoluteFill, { opacity: 0.6 }]} contentFit="cover" blurRadius={24} />
            <Image source={{ uri: picked.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
            {PhotoPreview && (look !== "none" || backdrop !== "blur") ? (
              <PhotoPreview uri={picked.uri} width={stageW} height={stageH} look={look} backdrop={backdrop} />
            ) : null}
          </>
        )}
        {layers
          .filter((l) => l.id !== editing?.id && !l.hidden)
          .map((l) => (
            <DraggableText
              key={l.id}
              layer={l}
              stageW={stageW}
              stageH={stageH}
              onMove={(x, y) => setLayers((ls) => ls.map((x0) => (x0.id === l.id ? { ...x0, x, y } : x0)))}
              onHide={() => setLayers((ls) => ls.map((x0) => (x0.id === l.id ? { ...x0, hidden: true } : x0)))}
              onTap={() => l.mentionAddress ? setMentionTarget({ layer: l }) : setEditing(l)}
            />
          ))}
        {hiddenCount > 0 && !editing ? (
          <View pointerEvents="box-none" style={styles.hiddenTray}>
            <TouchableOpacity className="dark-surface" onPress={() => setLayers((ls) => ls.map((l) => (l.hidden ? { ...l, hidden: false } : l)))}
              style={[styles.hiddenPill, styles.darkGlass]} accessibilityRole="button"
              accessibilityLabel={t("stories.showHidden", { defaultValue: "Show hidden ({{count}})", count: hiddenCount })}>
              <Icon name="EyeOff" size={14} color="#fff" />
              <Text style={styles.hiddenPillText}>{t("stories.hiddenCount", { defaultValue: "Hidden ({{count}})", count: hiddenCount })}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.stageTop}>
          <TouchableOpacity className="dark-surface" onPress={onBack} style={[styles.iconBtn, styles.darkGlass]} accessibilityLabel={t("stories.back", { defaultValue: "Back" })}>
            <Icon name="ChevronLeft" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.dismissBtn} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
            <View style={[styles.iconBtn, styles.closeBtn]}>
              <Icon name="X" size={22} color="#fff" />
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            {remixLabel ? <Text style={styles.remixLabel} numberOfLines={1}>{remixLabel}</Text> : null}
          </View>
          <View style={styles.tools}>
            {maxSeconds > 1 && (!isPhoto || customPhotoDuration) && (
              <TouchableOpacity className="dark-surface" onPress={() => setChoosingPlayback(true)}
                style={[styles.iconBtn, styles.darkGlass]} accessibilityRole="button" accessibilityLabel={playbackLabel}>
                <Icon name="Clock" size={20} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity className="dark-surface" onPress={startText} style={[styles.iconBtn, styles.darkGlass]} accessibilityLabel={t("stories.text", { defaultValue: "Text" })}>
              <Icon name="Type" size={20} color="#fff" />
            </TouchableOpacity>
            {picked.kind === "photo" && compose && PhotoPreview ? (
              <TouchableOpacity className="dark-surface" onPress={() => setEffectsOpen(true)} style={[styles.iconBtn, styles.darkGlass]} accessibilityRole="button" accessibilityLabel={t("stories.effects", { defaultValue: "Effects" })}>
                <Icon name="Wand" size={20} color="#fff" />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity className="dark-surface" onPress={() => setStickersOpen(true)} style={[styles.iconBtn, styles.darkGlass]} accessibilityRole="button" accessibilityLabel={t("stories.stickers", { defaultValue: "Stickers" })}>
              <Icon name="Smile" size={20} color="#fff" />
            </TouchableOpacity>
            {compose && layers.filter((layer) => layer.mentionAddress).length < MAX_MENTIONS ? (
              <TouchableOpacity className="dark-surface" onPress={() => setMentionTarget({})} style={[styles.iconBtn, styles.darkGlass]} accessibilityRole="button"
                accessibilityLabel={t("upload.studio.mention", { defaultValue: "Mention" })}>
                <Icon name="AtSign" size={20} color="#fff" />
              </TouchableOpacity>
            ) : null}
            {picked.kind === "video" ? (
              <TouchableOpacity className="dark-surface" onPress={() => setMuted((m) => !m)} style={[styles.iconBtn, styles.darkGlass]} accessibilityLabel={t("stories.mute", { defaultValue: "Sound" })}>
                <Icon name={muted ? "VolumeX" : "Volume2"} size={20} color="#fff" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity onPress={() => setAudienceOpen(true)} style={[styles.chip, styles.darkGlass]}>
          <Icon name={audience === "everyone" ? "Globe" : "Users"} size={15} color="#fff" />
          <Text style={styles.chipText}>
            {audienceLabels[audience]}
          </Text>
        </TouchableOpacity>
        {customLifetime ? (
          <TouchableOpacity onPress={() => setChoosingLifetime(true)} style={[styles.chip, styles.darkGlass]} accessibilityRole="button" accessibilityLabel={`${lifetimeLabel}, ${lifetime}h`}>
            <Text style={styles.chipText}>{lifetime}h</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.chip, styles.darkGlass]}><Text style={styles.chipText}>24h</Text></View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => void share()} style={[styles.shareBtn, busy && { opacity: 0.6 }]} disabled={busy || (restrictPeople && !audiencePeople.length)}>
          {shareColors ? <LinearGradient colors={[shareColors.from, shareColors.to]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} /> : null}
          <Text style={[styles.shareText, shareColors && { color: shareColors.ink }]}>{t("stories.share", { defaultValue: "Share" })}</Text>
        </TouchableOpacity>
      </View>

      {audienceOpen && !pickingAudiencePerson && (
        <View style={styles.lifetimeOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAudienceOpen(false)} accessible={false} />
          <ScrollView style={[styles.textTools, { maxHeight: "75%" }]} contentContainerStyle={{ gap: 8, paddingBottom: insets.bottom + 16 }} accessibilityViewIsModal>
            {(Object.keys(audienceLabels) as StoryAudience[]).filter(mode => customAudience || mode === "everyone" || mode === "followers").map(mode => (
              <TouchableOpacity key={mode} style={[styles.chip, styles.darkGlass]} accessibilityRole="radio" accessibilityState={{ checked: mode === audience }}
                onPress={() => {
                  audienceChosen.current = true;
                  if (mode !== audience) setAudiencePeople([]);
                  setAudience(mode);
                  if (mode === "followers" || mode === "everyone") AsyncStorage.setItem(AUDIENCE_KEY, mode).catch(() => {});
                }}>
                {mode === audience && <Icon name="Check" size={16} color="#fff" />}
                <Text style={styles.chipText}>{audienceLabels[mode]}</Text>
              </TouchableOpacity>
            ))}
            {customAudience && closeFriends.length > 0 && (
              <TouchableOpacity style={[styles.chip, styles.darkGlass]} accessibilityRole="button"
                onPress={() => { audienceChosen.current = true; setAudience("selected"); setAudiencePeople(closeFriends); }}>
                <Icon name="Users" size={16} color="#fff" />
                <Text style={styles.chipText}>{t("stories.closeFriends", { defaultValue: "Close friends" })} ({closeFriends.length})</Text>
              </TouchableOpacity>
            )}
            {audience === "selected" && audiencePeople.length > 0 && (
              <TouchableOpacity style={[styles.chip, styles.darkGlass]} accessibilityRole="button"
                onPress={() => {
                  setCloseFriends(audiencePeople);
                  AsyncStorage.setItem(CLOSE_FRIENDS_KEY, JSON.stringify(audiencePeople)).catch(() => {});
                  toastSuccess(t("stories.closeFriendsSaved", { defaultValue: "Saved as your Close friends" }));
                }}>
                <Icon name="Check" size={16} color="#fff" />
                <Text style={styles.chipText}>{t("stories.saveCloseFriends", { defaultValue: "Save as Close friends" })}</Text>
              </TouchableOpacity>
            )}
            {restrictPeople && <>
              {audiencePeople.map(user => (
                <TouchableOpacity key={user.address} style={[styles.chip, styles.darkGlass]} onPress={() => setAudiencePeople(current => current.filter(item => item.address !== user.address))}>
                  <Text style={styles.chipText}>@{user.username} ×</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.chip, styles.darkGlass]} disabled={audiencePeople.length >= 50} onPress={() => setPickingAudiencePerson(true)}>
                <Icon name="Search" size={16} color="#fff" /><Text style={styles.chipText}>{t("common.search", { defaultValue: "Search" })}</Text>
              </TouchableOpacity>
            </>}
            <TouchableOpacity style={[styles.chip, styles.darkGlass]} onPress={() => setAudienceOpen(false)}>
              <Text style={styles.chipText}>{t("common.done", { defaultValue: "Done" })}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}
      {stickersOpen && (
        <View style={styles.lifetimeOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setStickersOpen(false)} accessible={false} />
          <View style={[styles.textTools, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
            <View style={styles.textRow}>
              <Text style={[styles.chipText, { flex: 1 }]}>{t("stories.stickers", { defaultValue: "Stickers" })}</Text>
              <TouchableOpacity onPress={() => setStickersOpen(false)} style={[styles.chip, styles.darkGlass]} accessibilityRole="button">
                <Text style={styles.chipText}>{t("common.done", { defaultValue: "Done" })}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {[...STICKER_EMOJI, ...STICKER_SHAPES].map((g) => (
                <TouchableOpacity key={g} onPress={() => addSticker(g)} accessibilityRole="button" accessibilityLabel={g}
                  style={{ width: "14.28%", height: 48, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 26, color: "#fff", fontWeight: "700" }}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{t("stories.shapes", { defaultValue: "Arrows and shapes. Tap one after adding it to change its colour, size or angle." })}</Text>
          </View>
        </View>
      )}
      {effectsOpen && (
        <View style={styles.lifetimeOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEffectsOpen(false)} accessible={false} />
          <View style={[styles.textTools, { paddingBottom: insets.bottom + 16, gap: 10 }]} accessibilityViewIsModal>
            <View style={styles.textRow}>
              <Text style={[styles.chipText, { flex: 1 }]}>{t("stories.effects", { defaultValue: "Effects" })}</Text>
              <TouchableOpacity onPress={() => setEffectsOpen(false)} style={[styles.chip, styles.darkGlass]} accessibilityRole="button">
                <Text style={styles.chipText}>{t("common.done", { defaultValue: "Done" })}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {(Object.keys(PHOTO_LOOKS) as PhotoLook[]).map((key) => (
                <TouchableOpacity key={key} onPress={() => setLook(key)} style={[styles.chip, styles.darkGlass]} accessibilityRole="radio" accessibilityState={{ checked: look === key }}>
                  {look === key && <Icon name="Check" size={16} color="#fff" />}
                  <Text style={styles.chipText}>{t(`stories.looks.${key}`, { defaultValue: key })}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={{ color: "hsla(0,0%,100%,0.6)", fontSize: 12 }}>{t("stories.backdrop", { defaultValue: "Background" })}</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(Object.keys(PHOTO_BACKDROPS) as PhotoBackdrop[]).map((key) => {
                const stops = PHOTO_BACKDROPS[key];
                return (
                  <TouchableOpacity key={key} onPress={() => setBackdrop(key)} accessibilityRole="radio" accessibilityState={{ checked: backdrop === key }}
                    accessibilityLabel={t(`stories.backdrops.${key}`, { defaultValue: key })}
                    style={{ width: 36, height: 36, borderRadius: 18, overflow: "hidden", borderWidth: 2, borderColor: backdrop === key ? "#fff" : "hsla(0,0%,100%,0.25)", alignItems: "center", justifyContent: "center" }}>
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: stops ? stops[0] : "hsla(0,0%,100%,0.15)" }]} />
                    {stops ? <View style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "50%", backgroundColor: stops[1] }} /> : <Icon name="Palette" size={16} color="#fff" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
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
              <TouchableOpacity onPress={() => setChoosingPlayback(false)} style={[styles.chip, styles.darkGlass]} accessibilityRole="button">
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
            <TouchableOpacity style={[styles.chip, styles.darkGlass]} onPress={onRemove} accessibilityRole="button">
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
  onHide,
}: {
  layer: TextLayer;
  stageW: number;
  stageH: number;
  onMove: (x: number, y: number) => void;
  onTap: () => void;
  /** Let go past the edge of the picture: the layer hides (it can be brought back). */
  onHide: () => void;
}) {
  const start = useRef({ x: layer.x, y: layer.y });
  // Fades while the finger has the layer past the edge, as a "let go to hide" cue.
  const [leaving, setLeaving] = useState(false);
  // PanResponder keeps cumulative movement for the lifetime of a gesture.
  // The parent updates the text layer on every move, including its callbacks.
  const latest = useRef({ layer, onMove, onTap, onHide });
  latest.current = { layer, onMove, onTap, onHide };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = { x: latest.current.layer.x, y: latest.current.layer.y };
        },
        onPanResponderMove: (_e, g) => {
          const rawX = start.current.x + g.dx / stageW;
          const rawY = start.current.y + g.dy / stageH;
          setLeaving(isOffStage(rawX, rawY));
          const x = Math.min(0.95, Math.max(0.05, rawX));
          const y = Math.min(0.95, Math.max(0.05, rawY));
          latest.current.onMove(x, y);
        },
        onPanResponderRelease: (_e, g) => {
          setLeaving(false);
          if (Math.abs(g.dx) < 4 && Math.abs(g.dy) < 4) return latest.current.onTap();
          if (isOffStage(start.current.x + g.dx / stageW, start.current.y + g.dy / stageH)) latest.current.onHide();
        },
        onPanResponderTerminate: () => setLeaving(false),
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
        style={{ opacity: leaving ? 0.35 : 1, transform: [
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

/** The finger has carried the layer's centre past the edge of the picture. */
function isOffStage(x: number, y: number) {
  return x < 0 || x > 1 || y < 0 || y > 1;
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
            <TouchableOpacity onPress={() => onChange({ ...layer, box: !layer.box })} style={[styles.chip, styles.darkGlass]}>
              <Text style={styles.chipText}>{layer.box ? t("stories.boxOn", { defaultValue: "Box on" }) : t("stories.boxOff", { defaultValue: "Box off" })}</Text>
            </TouchableOpacity>
            {compose && (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("dmVideo.rotate", { defaultValue: "Rotate" })}
                accessibilityValue={{ text: `${layer.rotation ?? 0}°` }} style={[styles.chip, styles.darkGlass]}
                onPress={() => onChange({ ...layer, rotation: ((layer.rotation ?? 0) + 45) % 360 })}>
                <Icon name="RotateCw" size={16} color="#fff" />
                <Text style={styles.chipText}>{layer.rotation ?? 0}°</Text>
              </TouchableOpacity>
            )}
            {compose && (
              <TouchableOpacity
                accessibilityRole="button" accessibilityLabel={t("stories.captionFont", { defaultValue: "Caption font" })}
                accessibilityState={{ expanded: fontsOpen }} style={[styles.chip, styles.darkGlass]}
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
  remixLabel: { color: "#fff", fontSize: 13, fontWeight: "600", marginHorizontal: 6, textShadowColor: "#000", textShadowRadius: 5 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
  },
  closeBtn: { backgroundColor: "#242427" },
  /** Web's dark glass over a photo: see-through dark, thin light rim. */
  darkGlass: { backgroundColor: "rgba(20,20,24,0.5)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.16)" },
  camStage: { position: "absolute", left: 8, right: 8, borderRadius: 24, overflow: "hidden", backgroundColor: "#111" },
  camOff: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  camOffTitle: { color: "#fff", fontSize: 17, fontWeight: "600" },
  camOffBody: { color: "rgba(255,255,255,0.7)", fontSize: 14, textAlign: "center", marginBottom: 12 },
  camTop: { position: "absolute", left: 20, right: 20, flexDirection: "row", alignItems: "center", gap: 10 },
  camBottom: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center" },
  camHint: { position: "absolute", alignSelf: "center", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.35)" },
  camHintText: { color: "rgba(255,255,255,0.85)", fontSize: 12 },
  shutterHit: { position: "absolute", alignSelf: "center", width: 76, height: 76 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#fff",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  shutterDown: { transform: [{ scale: 0.94 }], backgroundColor: "rgba(255,255,255,0.4)" },
  dismissBtn: { marginLeft: 8 },
  stage: { alignSelf: "center", borderRadius: 24, overflow: "hidden", backgroundColor: "#111" },
  hiddenTray: { position: "absolute", left: 0, right: 0, bottom: 14, alignItems: "center" },
  hiddenPill: { flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16 },
  hiddenPillText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  stageTop: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", alignItems: "flex-start" },
  tools: { gap: 10 },
  bottomBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  chip: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  chipOn: { backgroundColor: "rgba(255,255,255,0.28)" },
  chipText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  shareBtn: { height: 48, paddingHorizontal: 20, borderRadius: 24, overflow: "hidden", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  shareText: { color: "#000", fontSize: 15, fontWeight: "700" },
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
