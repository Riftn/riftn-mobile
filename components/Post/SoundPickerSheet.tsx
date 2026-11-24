import { useSurfaceDraft } from '../../hooks/useSurfaceDraft';
import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  useWindowDimensions,
  StyleSheet,
  PanResponder,
  Animated,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import Avatar from "../common/Avatar";
import Slider from "@react-native-community/slider";
import { Image } from "expo-image";
import { apiClient } from "../../libs/api.client";
import { outsideImage } from "../../libs/outside-image";
import { clock, playableSoundUrl, soundWindow, soundWindowCorrection, suggestedSoundStart, withSoundWindow, SOUND_SOURCE_NAMES } from "../../libs/soundWindow";
import { useAudioPlayer } from "expo-audio";
import { getUnifiedFeed, type UnifiedFeedItem } from "../../services/feed.unified.service";
import { buildImageUrl, getAvatarUrl } from "../../libs";
import type { AttachedSound } from "../../hooks/usePostSound";

const MIN_PCT = 0.55;
const MAX_PCT = 0.92;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (sound: AttachedSound) => void;
  currentSound?: AttachedSound | null;
  /** Length of the attached video, in seconds: the part matches it. */
  clipSeconds?: number;
  /**
   * Over the video edit screen: a solid panel. The glass (or a canvas theme's
   * see-through card) let the editor and its video show through.
   */
  opaque?: boolean;
  /** Open straight on this song's part step (screenshot harness). */
  initialPicked?: SoundCandidate;
  initialLibrary?: Library;
}

export type Library = "audius" | "riftn" | "commons";

/** One song in the list, from any library. */
export interface SoundCandidate {
  key: string;
  library: Library;
  /** Plain stream link, no part or credit yet. */
  url: string;
  title: string;
  creator: string;
  artwork?: string;
  tokenId: string;
  duration?: number;
  pageUrl?: string;
  license?: string;
  licenseUrl?: string;
}

interface OutsideTrack {
  id: string; source: "audius" | "commons"; title: string; artist: string; artwork?: string;
  duration: number; streamUrl: string; pageUrl: string; license: string; licenseUrl?: string;
}

const LENGTHS = [15, 30, 60] as const;

async function fetchOutside(source: "audius" | "commons", q: string, offset: number) {
  const body = await apiClient.get<{ tracks?: OutsideTrack[]; nextOffset?: number }>("/sounds", {
    isAuthRequired: false,
    params: { source, offset: String(offset), ...(q ? { q } : {}) },
  });
  return {
    items: (body?.tracks ?? []).map((t): SoundCandidate => ({
      key: t.id, library: t.source, url: t.streamUrl, title: t.title, creator: t.artist,
      artwork: t.artwork, tokenId: "0", duration: t.duration, pageUrl: t.pageUrl,
      license: t.license, licenseUrl: t.licenseUrl,
    })),
    next: body?.nextOffset,
  };
}

/** Stable bar heights per song, so the same song always draws the same wave. */
function waveFor(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: count }, (_, i) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) + i;
    return 0.25 + 0.75 * (((h >>> 0) % 1000) / 1000) * (Math.abs(Math.sin(i * 0.45)) * 0.5 + 0.5);
  });
}

import { requestAudioFocus, releaseAudioFocus } from "../../libs/audioFocus";
import { SHEET_GLASS_FILL, SHEET_GLASS_BORDER } from "../../theme/sheetGlass";
import SheetGlass, { GLASS_PANEL_CLEAR, useDrawerGlass } from "../ui/SheetGlass";
import SheetBackdrop, { useSheetBackdrop } from "../ui/SheetBackdrop";

const CDN_BASE = "https://dehubcdn.ams3.cdn.digitaloceanspaces.com";

const resolveAudioUrl = (audioUrl?: string | null, tokenId?: string | number): string => {
  if (audioUrl) {
    if (audioUrl.startsWith("http")) return audioUrl;
    return `${CDN_BASE}/${audioUrl.replace(/^\/+/, '')}`;
  }
  return `${CDN_BASE}/feed-audio/${tokenId}-audio.mp3`;
};

// The picked title goes into the post's soundtrack tag, so only the list row shows a translated fallback.
const resolveTrackTitle = (item: UnifiedFeedItem, untitled = "Untitled"): string => {
  if (item.name && item.name.trim()) return item.name.trim();
  if (item.description) return item.description.split("\n")[0].trim() || untitled;
  return untitled;
};

const toRiftnCandidate = (item: UnifiedFeedItem): SoundCandidate => {
  const tokenId = String(item.tokenId ?? "");
  return {
    key: `riftn:${tokenId}`,
    library: "riftn",
    url: resolveAudioUrl(item.audioUrl, tokenId),
    title: resolveTrackTitle(item),
    creator: item.minterDisplayName || item.minterUsername || item.minter || "",
    // The song's own cover photo when the post has one, else the uploader's photo.
    artwork: (item.imageUrl ? buildImageUrl(tokenId, item.imageUrl, 160) : "") || (item.minterAvatarUrl ? getAvatarUrl(item.minterAvatarUrl) : undefined),
    tokenId,
    duration: item.audioDuration,
  };
};

async function fetchRiftn(q: string, page: number) {
  const res = await getUnifiedFeed({ postType: "feed-audio", sortBy: "likes", page, limit: 20, search: q || undefined });
  return { items: (res.result || []).map(toRiftnCandidate), next: res.pagination?.hasMore ? page + 1 : undefined };
}

const SoundPickerSheet: React.FC<Props> = ({ visible, onClose, onSelect, currentSound, clipSeconds, initialPicked, initialLibrary, opaque }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const glassPanel = useDrawerGlass() && !opaque;
  // Android blurs the page behind live and re-samples it on every window
  // draw, so a sheet that scrolls (or plays GIFs) paid for it each frame.
  // A plain scrim there, as the comments sheet and page drawers already use.
  const backdrop = useSheetBackdrop(visible && Platform.OS !== "android");
  const { height: SCREEN_H } = useWindowDimensions();
  const [library, setLibrary] = useState<Library>(initialLibrary ?? "audius");
  const [searchText, setSearchText] = useSurfaceDraft("components/Post/SoundPickerSheet.tsx:searchText", "");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [results, setResults] = useState<SoundCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [next, setNext] = useState<number | undefined>(undefined);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<SoundCandidate | null>(initialPicked ?? null);
  const [start, setStart] = useState(initialPicked ? 42 : 0);
  const [length, setLength] = useState<number>(30);
  // Single preview player; each track is attached with replace() rather than
  // creating and unloading a Sound per tap.
  const previewPlayer = useAudioPlayer(null);
  const previewUrl = useRef<string | null>(null);

  const [heightPct, setHeightPct] = useState(initialPicked ? MAX_PCT : MIN_PCT);
  const heightAnim = useRef(new Animated.Value(initialPicked ? MAX_PCT : MIN_PCT)).current;

  // Reset on open
  useEffect(() => {
    if (visible) {
      setHeightPct(initialPicked ? MAX_PCT : MIN_PCT);
      setSearchText.initialize("");
      setResults([]);
      setNext(undefined);
    } else {
      setPicked(initialPicked ?? null);
    }
  }, [visible, setSearchText, initialPicked]);

  useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: heightPct,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [heightPct, heightAnim]);

  // The part step needs the room.
  useEffect(() => { if (picked) setHeightPct(MAX_PCT); }, [picked]);

  // Draggable handle
  const panY = useRef(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          panY.current = 0;
        },
        onPanResponderMove: (_, g) => {
          panY.current = g.dy;
          const pct = Math.max(MIN_PCT, Math.min(MAX_PCT, heightPct - g.dy / SCREEN_H));
          heightAnim.setValue(pct);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > 80 || g.vy > 0.5) {
            onClose();
          } else {
            Animated.spring(heightAnim, {
              toValue: heightPct < (MIN_PCT + MAX_PCT) / 2 ? MIN_PCT : MAX_PCT,
              useNativeDriver: false,
            }).start(({ finished }) => {
              if (finished) setHeightPct(heightPct < (MIN_PCT + MAX_PCT) / 2 ? MIN_PCT : MAX_PCT);
            });
          }
        },
      }),
    [heightPct, heightAnim, onClose, SCREEN_H],
  );

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText.trim()), 400);
    return () => clearTimeout(t);
  }, [searchText]);

  const load = useCallback((offset: number) => library === "riftn"
    ? fetchRiftn(debouncedSearch, offset || 1)
    : fetchOutside(library, debouncedSearch, offset), [library, debouncedSearch]);

  // First page of the library / search
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setResults([]);
    setLoading(true);
    setFailed(false);
    load(0)
      .then((page) => { if (!cancelled) { setResults(page.items); setNext(page.next); } })
      .catch((e) => { if (!cancelled) setFailed(true); console.warn("[SoundPicker] Fetch error:", e?.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, load]);

  const loadMore = useCallback(async () => {
    if (loading || next == null) return;
    setLoading(true);
    try {
      const page = await load(next);
      setResults((prev) => {
        const seen = new Set(prev.map((item) => item.key));
        return [...prev, ...page.items.filter((item) => !seen.has(item.key))];
      });
      setNext(page.next);
    } catch (e: any) {
      console.warn("[SoundPicker] Load more error:", e?.message);
    } finally {
      setLoading(false);
    }
  }, [loading, next, load]);

  // expo-audio has no stop(); pause + rewind is the equivalent.
  const stopPreview = useCallback(() => {
    try {
      previewPlayer.pause();
      void previewPlayer.seekTo(0).catch(() => {});
    } catch {}
    releaseAudioFocus(stopPreview);
    setPlayingKey(null);
  }, [previewPlayer]);

  const playPreview = useCallback((key: string, url: string) => {
    if (playingKey === key) { stopPreview(); return; }
    stopPreview();
    try {
      requestAudioFocus(stopPreview);
      previewPlayer.replace({ uri: playableSoundUrl(url) });
      previewUrl.current = url;
      const part = soundWindow(url);
      if (part) void previewPlayer.seekTo(part.start).catch(() => {});
      previewPlayer.play();
      setPlayingKey(key);
    } catch (e) {
      console.warn("[SoundPicker] Preview error:", e);
      releaseAudioFocus(stopPreview);
      setPlayingKey(null);
    }
  }, [playingKey, previewPlayer, stopPreview]);

  // Keep a part preview inside its part; clear the pill at the end of a song.
  useEffect(() => {
    const sub = previewPlayer.addListener("playbackStatusUpdate", (status) => {
      if (!status.isLoaded) return;
      const jump = soundWindowCorrection(previewUrl.current, status.currentTime ?? 0);
      if (jump != null) { void previewPlayer.seekTo(jump).catch(() => {}); return; }
      if (status.didJustFinish) {
        releaseAudioFocus(stopPreview);
        setPlayingKey(null);
      }
    });
    return () => sub.remove();
  }, [previewPlayer, stopPreview]);

  // Stop preview on close. The player is released by useAudioPlayer.
  useEffect(() => {
    if (!visible) stopPreview();
  }, [visible, stopPreview]);

  useEffect(() => () => { releaseAudioFocus(stopPreview); }, [stopPreview]);

  // The part's length: the video's, or a chosen length for photos.
  const fixedLength = clipSeconds && clipSeconds > 0 ? Math.max(3, Math.round(clipSeconds)) : undefined;
  const duration = picked?.duration && picked.duration > 0 ? picked.duration : undefined;
  const partLength = Math.min(fixedLength ?? length, duration ?? Infinity);
  const wholeSong = !duration || duration <= partLength + 0.5;
  const maxStart = duration && !wholeSong ? Math.max(0, duration - partLength) : 0;
  const clampedStart = Math.min(start, maxStart);

  const partUrl = useCallback((track: SoundCandidate) => withSoundWindow(
    track.url,
    wholeSong && clampedStart <= 0 ? null : { start: clampedStart, end: wholeSong ? undefined : clampedStart + partLength },
    track.library === "riftn" ? null : { source: track.library, page: track.pageUrl, license: track.license, licenseUrl: track.licenseUrl },
  ), [wholeSong, clampedStart, partLength]);

  const pick = useCallback((track: SoundCandidate) => {
    stopPreview();
    const same = currentSound && playableSoundUrl(currentSound.url) === track.url;
    // A new song opens on its likely chorus; re-opening the current one keeps its part.
    const fresh = suggestedSoundStart(track.duration, fixedLength ?? length);
    setStart(same ? soundWindow(currentSound!.url)?.start ?? 0 : fresh);
    setPicked(track);
  }, [currentSound, stopPreview, fixedLength, length]);

  const confirm = useCallback(() => {
    if (!picked) return;
    stopPreview();
    onSelect({
      url: partUrl(picked),
      title: picked.title,
      creator: picked.creator,
      creatorAvatar: picked.artwork,
      tokenId: picked.tokenId,
      duration: picked.duration,
      source: picked.library,
    });
    setPicked(null);
  }, [picked, stopPreview, onSelect, partUrl]);

  // Moving the part restarts a playing preview at its new start.
  const partKey = picked ? `part:${picked.key}` : "";
  useEffect(() => {
    if (!picked || playingKey !== partKey) return;
    const timer = setTimeout(() => {
      const url = partUrl(picked);
      previewUrl.current = url;
      const part = soundWindow(url);
      void previewPlayer.seekTo(part?.start ?? 0).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedStart, partLength]);

  const bars = useMemo(() => waveFor(picked?.key ?? "", 48), [picked?.key]);
  const libraries: { id: Library; label: string }[] = [
    { id: "audius", label: "Audius" },
    { id: "riftn", label: "Riftn" },
    { id: "commons", label: t("copy.c0963b7d9c5d", { defaultValue: "Free library" }) },
  ];

  const renderItem = useCallback(
    ({ item }: { item: SoundCandidate }) => {
      const isPlaying = playingKey === item.key;
      const isSelected = !!currentSound && playableSoundUrl(currentSound.url) === item.url;
      const art = item.artwork ? outsideImage(item.artwork) : undefined;
      return (
        <TouchableOpacity
          style={[styles.trackRow, isSelected && styles.trackRowSelected]}
          activeOpacity={0.7}
          onPress={() => pick(item)}
          accessibilityRole="button"
        >
          <TouchableOpacity
            style={styles.artBtn}
            onPress={() => playPreview(item.key, item.url)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? t("audioPost.pause") : t("audioPost.play")}
          >
            {art ? (
              <Image source={{ uri: art }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : item.library === "riftn" ? (
              <Avatar uri={item.artwork} name={item.creator} size={44} />
            ) : null}
            <View style={[styles.artShade, !art && item.library !== "riftn" && styles.artShadeEmpty]}>
              <Ionicons name={isPlaying ? "pause" : art || item.library === "riftn" ? "play" : "musical-notes"} size={16} color="#fff" />
            </View>
          </TouchableOpacity>
          <View style={styles.trackInfo}>
            <Text style={styles.trackTitle} numberOfLines={1}>{item.title || t("copy.f59ab8d1331b", { defaultValue: "Untitled" })}</Text>
            <Text style={styles.trackCreator} numberOfLines={1}>
              {item.creator || t("settings.unknown")}
              {item.duration ? ` · ${clock(item.duration)}` : ""}
              {item.library === "commons" && item.license ? ` · ${item.license}` : ""}
            </Text>
          </View>
          {isSelected ? <Ionicons name="checkmark" size={20} color="#fff" /> : <Ionicons name="chevron-forward" size={18} color="#6F7174" />}
        </TouchableOpacity>
      );
    },
    [playingKey, currentSound, playPreview, pick, t],
  );

  // No early return: the Modal stays mounted so closing fades it out.

  const sheetHeight = heightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCREEN_H],
  });

  const credit = picked && picked.library !== "riftn"
    ? [picked.creator ? `© ${picked.creator}` : "", picked.license, SOUND_SOURCE_NAMES[picked.library]].filter(Boolean).join(" · ")
    : "";
  const partPlaying = !!picked && playingKey === partKey;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => (picked ? setPicked(null) : onClose())}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
      <SheetBackdrop backdrop={backdrop} />
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.sheet, glassPanel && GLASS_PANEL_CLEAR, opaque && styles.sheetSolid, { height: sheetHeight }]}>
        {glassPanel ? <SheetGlass backdropBlurred={backdrop.blurred} /> : null}
        {/* Only the handle + header drag the sheet; on the whole sheet the
            responder claimed every vertical move, so scrolling the results
            resized or closed it. */}
        <View {...responder.panHandlers}>
          {/* Handle bar */}
          <View style={styles.handleBar}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {picked && (
                <TouchableOpacity
                  onPress={() => { stopPreview(); setPicked(null); }}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t("profile.back")}
                >
                  <Ionicons name="chevron-back" size={24} color="#fff" />
                </TouchableOpacity>
              )}
              <Text style={styles.title}>{picked ? t("copy.55b1ec6f0360", { defaultValue: "Pick the part" }) : t("upload.addSound")}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {picked ? (
          <View style={[styles.part, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.partHead}>
              <View style={styles.partArt}>
                {picked.artwork ? <Image source={{ uri: outsideImage(picked.artwork) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="musical-notes" size={22} color="#fff" />}
              </View>
              <View style={styles.trackInfo}>
                <Text style={styles.partTitle} numberOfLines={1}>{picked.title}</Text>
                <Text style={styles.trackCreator} numberOfLines={1}>{picked.creator}</Text>
                {!!credit && (
                  <Text
                    style={styles.partCredit}
                    numberOfLines={1}
                    onPress={picked.pageUrl ? () => { void Linking.openURL(picked.pageUrl!).catch(() => {}); } : undefined}
                  >
                    {credit}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.partPlay}
                onPress={() => playPreview(partKey, partUrl(picked))}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={partPlaying ? t("audioPost.pause") : t("audioPost.play")}
              >
                <Ionicons name={partPlaying ? "pause" : "play"} size={22} color="#000" style={partPlaying ? undefined : { marginLeft: 2 }} />
              </TouchableOpacity>
            </View>

            {/* The song as a wave; the lit stretch is the part the post plays. */}
            <View style={styles.waveBox}>
              <View style={styles.waveRow}>
                {bars.map((h, i) => {
                  const at = duration ? ((i + 0.5) / bars.length) * duration : 0;
                  const lit = wholeSong || (at >= clampedStart && at <= clampedStart + partLength);
                  return <View key={i} style={[styles.waveBar, { height: `${Math.round(h * 100)}%`, opacity: lit ? 1 : 0.25 }]} />;
                })}
              </View>
              {!wholeSong && (
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={maxStart}
                  step={0.5}
                  value={clampedStart}
                  onValueChange={(value) => setStart(value)}
                  minimumTrackTintColor="rgba(255,255,255,0.9)"
                  maximumTrackTintColor="rgba(255,255,255,0.25)"
                  thumbTintColor="#fff"
                  accessibilityLabel={t("copy.284b838e96e5", { defaultValue: "Where the part starts" })}
                />
              )}
              <View style={styles.partTimes}>
                <Text style={styles.partTime}>{clock(wholeSong ? 0 : clampedStart)} – {clock(wholeSong ? (duration ?? 0) : clampedStart + partLength)}</Text>
                <Text style={styles.partTime}>{wholeSong ? t("copy.46b0e30a32b0", { defaultValue: "Whole song" }) : t("copy.3a84120779c5", { defaultValue: "Slide to pick the part" })}</Text>
              </View>
            </View>

            {fixedLength ? (
              <Text style={styles.partHint}>{t("copy.1cb1b494ee3b", { defaultValue: "The part matches your video ({{value1}}).", value1: clock(fixedLength) })}</Text>
            ) : (
              <View style={styles.lengthRow}>
                {LENGTHS.map((seconds) => (
                  <TouchableOpacity
                    key={seconds}
                    onPress={() => setLength(seconds)}
                    style={[styles.chip, styles.lengthChip, length === seconds && styles.chipOn]}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: length === seconds }}
                  >
                    <Text style={[styles.chipText, length === seconds && styles.chipTextOn]}>{seconds}s</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.useBtn} onPress={confirm} activeOpacity={0.85} accessibilityRole="button">
              <Text style={styles.useBtnText}>{t("copy.0418db35eb35", { defaultValue: "Use this sound" })}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Libraries */}
            <View style={styles.libraryRow}>
              {libraries.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => { stopPreview(); setLibrary(item.id); }}
                  style={[styles.chip, library === item.id && styles.chipOn]}
                  activeOpacity={0.8}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: library === item.id }}
                >
                  <Text style={[styles.chipText, library === item.id && styles.chipTextOn]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Search */}
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={18} color="#6F7174" />
              <TextInput
                style={styles.searchInput}
                placeholder={library === "audius" ? t("copy.ecb30523a48a", { defaultValue: "Search songs and artists" }) : t("upload.searchSoundsPlaceholder")}
                placeholderTextColor="#6F7174"
                value={searchText}
                onChangeText={setSearchText}
                autoCorrect={false}
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText.complete(searchText, "")}>
                  <Ionicons name="close-circle" size={18} color="#6F7174" />
                </TouchableOpacity>
              )}
            </View>
            {library !== "riftn" && !debouncedSearch && (
              <Text style={styles.libraryHint}>
                {library === "audius"
                  ? t("copy.cbade2afaee2", { defaultValue: "Trending this week on Audius. Free to use, the artist gets credited on your post." })
                  : t("copy.d2e45b7406fc", { defaultValue: "Public domain and Creative Commons music from Wikimedia Commons. The artist gets credited on your post." })}
              </Text>
            )}

            {/* Results */}
            <FlatList
              data={results}
              renderItem={renderItem}
              keyExtractor={(item) => item.key}
              contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom, 16) }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              ListEmptyComponent={
                loading ? (
                  <ActivityIndicator style={{ marginTop: 40 }} color="#A1A1AA" />
                ) : (
                  <Text style={styles.emptyText}>
                    {failed
                      ? t("copy.d0c1a3684775", { defaultValue: "Songs didn't load. Try again in a moment." })
                      : debouncedSearch ? t("upload.noSoundsFound") : t("upload.noAudioPosts")}
                  </Text>
                )
              }
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                loading && results.length > 0 ? (
                  <ActivityIndicator style={{ padding: 16 }} color="#A1A1AA" />
                ) : null
              }
            />
          </>
        )}
      </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  // The dim and blur come from SheetBackdrop, under the whole modal.
  backdrop: { flex: 1 },
  sheet: {
    marginTop: "auto",
    width: "100%",
    maxHeight: "100%",
    backgroundColor: SHEET_GLASS_FILL,
    borderWidth: 1,
    borderColor: SHEET_GLASS_BORDER,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  // Written as rgb() on purpose: the canvas themes repaint the near-black
  // glass fill with their own see-through card (libs/jsx/shape.js).
  sheetSolid: { backgroundColor: "rgb(14,14,17)" },
  handleBar: { alignItems: "center", paddingTop: 10, paddingBottom: 4 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 18, fontWeight: "700", color: "#fff" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  libraryRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  chip: { height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "transparent" },
  // Fills take the theme's control material, so the pick shows as a ring.
  chipOn: { backgroundColor: "rgba(255,255,255,0.22)", borderColor: "rgba(255,255,255,0.75)" },
  chipText: { fontSize: 14, fontWeight: "500", color: "rgba(255,255,255,0.7)" },
  chipTextOn: { color: "#fff", fontWeight: "700" },
  libraryHint: { fontSize: 11, color: "#8A8D91", marginHorizontal: 16, marginBottom: 6 },
  artBtn: { width: 44, height: 44, borderRadius: 10, overflow: "hidden", marginRight: 12, backgroundColor: "rgba(255,255,255,0.1)" },
  artShade: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  artShadeEmpty: { backgroundColor: "transparent" },
  part: { flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  partHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  partArt: { width: 56, height: 56, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  partTitle: { fontSize: 16, fontWeight: "700", color: "#fff" },
  partCredit: { fontSize: 11, color: "#8A8D91", marginTop: 2 },
  partPlay: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  waveBox: { borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 10 },
  waveRow: { flexDirection: "row", alignItems: "center", gap: 2, height: 52 },
  waveBar: { flex: 1, borderRadius: 2, backgroundColor: "#fff" },
  slider: { width: "100%", height: 32, marginTop: 6 },
  partTimes: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  partTime: { fontSize: 12, color: "#A6A9AC", fontVariant: ["tabular-nums"] },
  partHint: { fontSize: 12, color: "#8A8D91" },
  lengthRow: { flexDirection: "row", gap: 8 },
  lengthChip: { flex: 1, height: 36 },
  useBtn: { height: 50, borderRadius: 25, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  useBtnText: { fontSize: 16, fontWeight: "700", color: "#09090B" },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#1D1F21",
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, color: "#fff" },
  list: { paddingHorizontal: 16 },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 2,
  },
  trackRowSelected: { backgroundColor: "rgba(255,255,255,0.08)" },
  trackInfo: { flex: 1 },
  trackTitle: { fontSize: 14, fontWeight: "600", color: "#fff" },
  trackCreator: { fontSize: 12, color: "#A6A9AC", marginTop: 2 },
  emptyText: { textAlign: "center", color: "#6F7174", marginTop: 40, fontSize: 14 },
});

export default React.memo(SoundPickerSheet);
