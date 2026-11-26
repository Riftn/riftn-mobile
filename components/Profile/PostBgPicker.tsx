import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { useAuthActions, useUser } from "../../context/AuthContext";
import { AuthService } from "../../services/auth.service";
import { getAccount, setPostBackground } from "../../services/user.service";
import { toastError } from "../../libs/toast";
import { getAvatarUrl } from "../../libs/misc";
import { createLogger } from "../../libs/logger";
import {
  POST_BACKGROUNDS,
  POST_BG_IMAGE_KEY,
  POST_BG_PHOTO_ID,
  mergePostBg,
  postBgById,
  postBgFromStored,
  postBgStored,
  postBgPhotoStored,
  postBgImageUrl,
  postBgIsVideo,
  postBgPaletteIndex,
  withPostBgColors,
  type PostBg,
  type PostBgPalette,
} from "../../libs/postBackgrounds";
import { createRNImageFile, createRNVideoFile, openMediaPicker } from "../../libs/assets.util";
import Avatar from "../common/Avatar";
import { POST_BG_INK, PostBgLayer, ProfilePostBgArtContext, clearAllPostBgs, setPostBgForPost, setPostBgOverride, usePostOwnBg, useResolvedPostBg } from "./PostBackground";

const logger = createLogger("PostBgPicker");
/** Biggest video sent as a post background; the server cuts it to a short loop. */
const MAX_VIDEO_MB = 90;

/**
 * Profile post background picker: a full-screen preview of your newest text
 * post on the chosen backdrop, its colourways (plus your own colours), jump
 * chips, and one swipeable strip of every backdrop (None, your photo, moving,
 * still). Whatever sits in the middle is applied live; Done saves to customs
 * (postBg, postBgColors) and uploads a new photo when there is one. Opened by
 * holding your own profile header, or from Edit profile. Mounted once in App.tsx.
 */

/** The post that was held: its backdrop can be its own, or all posts' at once. */
export type PostBgTarget = { id?: unknown; tokenId?: unknown; postBg?: unknown; minter?: unknown };
type OpenRequest = { sampleText?: string; post?: PostBgTarget } | null;
let request: OpenRequest = null;
let tick = 0;
const subs = new Set<() => void>();
const sub = (l: () => void) => { subs.add(l); return () => subs.delete(l); };
const snap = () => tick;

export function openPostBgPicker(sampleText?: string, post?: PostBgTarget) {
  request = { sampleText, post: post && (post.tokenId ?? post.id) != null ? post : undefined };
  tick++;
  try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* not supported */ }
  subs.forEach((l) => l());
}
function closePostBgPicker() {
  request = null;
  tick++;
  subs.forEach((l) => l());
}

/** Wraps a press target on your own profile so holding it opens the picker. */
export function usePostBgHoldProps(enabled: boolean, sampleText?: string, post?: PostBgTarget) {
  return useMemo(
    () => (enabled ? { onLongPress: () => openPostBgPicker(sampleText, post), delayLongPress: 450 } : {}),
    [enabled, sampleText, post],
  );
}

const MOVING_BGS = POST_BACKGROUNDS.filter((b) => b.kind === "moving");
const STILL_BGS = POST_BACKGROUNDS.filter((b) => b.kind === "still");
const ORDER: (PostBg | null)[] = [null, postBgById(POST_BG_PHOTO_ID), ...MOVING_BGS, ...STILL_BGS];

/** Colours to build your own from: mono and chrome first, then the spectrum. */
const SWATCHES = [
  "#000000", "#0b0b0f", "#1c1c1f", "#3a3a40", "#6b6f78", "#9aa0aa", "#c9ccd4", "#e9e9ee", "#ffffff",
  "#2a0b0b", "#7c1733", "#ff3f6c", "#ff5f6d", "#ff7a1a", "#ffb347", "#ffd36b", "#fff3b0",
  "#0b2416", "#1d6b3e", "#2fd6a0", "#33ffa0", "#a3ff4f", "#d9ff6b",
  "#04122a", "#0a3871", "#1f6feb", "#2ea8ff", "#4fd1ff", "#9fd0ff",
  "#1a0b2b", "#5b2a8c", "#7b61ff", "#b25bff", "#ff6fb5", "#ffc2dc",
];
const TILE = 56;
const GAP = 10;
const STEP = TILE + GAP;

export default function PostBgPickerHost() {
  useSyncExternalStore(sub, snap, snap);
  const open = !!request;
  if (!open) return null;
  return <PostBgPicker sampleText={request?.sampleText} post={request?.post} />;
}

type Scope = "post" | "all";

function PostBgPicker({ sampleText, post }: { sampleText?: string; post?: PostBgTarget }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const user = useUser() as any;
  const { patchUser } = useAuthActions();
  const address: string = user?.walletAddress || user?.address || "";
  const profileCurrent = useResolvedPostBg(address, user?.customs);
  const postOwn = usePostOwnBg(post);
  const postId = post ? String(post.tokenId ?? post.id) : null;
  // Holding a post edits that post; "All posts" sets the profile backdrop and
  // puts every post back on it. From the header or Edit profile it's all posts.
  const [scope, setScope] = useState<Scope>(postId ? "post" : "all");
  const startBg = postId ? postOwn : profileCurrent;
  const current = scope === "post" ? postOwn : profileCurrent;
  const profilePhoto = profileCurrent?.kind === "photo" ? profileCurrent.image : postBgImageUrl(user?.customs?.[POST_BG_IMAGE_KEY]);
  const savedPhoto = current?.kind === "photo" ? current.image ?? profilePhoto : profilePhoto;
  const [sel, setSel] = useState<string | null>(startBg?.id ?? null);
  const [colorsById, setColorsById] = useState<Record<string, PostBgPalette>>(startBg?.colors && startBg.palettes.length ? { [startBg.id]: startBg.colors } : {});
  const [customOpen, setCustomOpen] = useState(!!startBg?.custom);
  const [well, setWell] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<FlatList<PostBg | null>>(null);
  const [startIndex] = useState(() => Math.max(0, ORDER.findIndex((b) => (b?.id ?? null) === (startBg?.id ?? null))));
  const photoSrc = photo ?? savedPhoto;

  useEffect(() => {
    const id = setTimeout(() => listRef.current?.scrollToOffset({ offset: startIndex * STEP, animated: false }), 0);
    return () => clearTimeout(id);
  }, [startIndex]);

  const changeScope = (nextScope: Scope) => {
    if (nextScope === scope || saving) return;
    const next = nextScope === "post" ? postOwn : profileCurrent;
    const nextId = next?.id ?? null;
    setScope(nextScope);
    setSel(nextId);
    setColorsById(next?.colors && next.palettes.length ? { [next.id]: next.colors } : {});
    setCustomOpen(!!next?.custom);
    setWell(0);
    setPhoto(null);
    const index = Math.max(0, ORDER.findIndex((b) => (b?.id ?? null) === nextId));
    listRef.current?.scrollToOffset({ offset: index * STEP, animated: false });
  };

  const choosePhoto = async () => {
    try {
      const picked = await openMediaPicker({ width: 1080, height: 1350, quality: 0.9 });
      if (!picked) return;
      if (picked.video && picked.size > MAX_VIDEO_MB * 1024 * 1024) { toastError(null, t("postBg.videoSize", { n: MAX_VIDEO_MB })); return; }
      setPhoto(picked.uri);
      setSel(POST_BG_PHOTO_ID);
      listRef.current?.scrollToOffset({ offset: STEP, animated: false });
    } catch { /* closed the picker */ }
  };

  const settle = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(ORDER.length - 1, Math.round(e.nativeEvent.contentOffset.x / STEP)));
    const id = ORDER[i]?.id ?? null;
    setSel((cur) => {
      if (cur !== id) { try { void Haptics.selectionAsync(); } catch { /* not supported */ } }
      return id;
    });
  }, []);

  const pick = (i: number) => {
    const id = ORDER[i]?.id ?? null;
    setSel(id);
    listRef.current?.scrollToOffset({ offset: i * STEP, animated: true });
    if (id === POST_BG_PHOTO_ID && !photoSrc) void choosePhoto();
  };
  const jump = (id: string) => pick(ORDER.findIndex((b) => b?.id === id));

  const base = postBgById(sel);
  const bg: PostBg | null = !base
    ? null
    : base.kind === "photo"
      ? (photoSrc ? { ...base, image: photoSrc } : base)
      : withPostBgColors(base, colorsById[base.id] ?? null);
  const picked = bg && (bg.kind !== "photo" || bg.image) ? bg : null;
  // On one post, None means "same as my profile": preview that.
  const followsProfile = scope === "post" && !base;
  const shown = followsProfile ? profileCurrent : picked;
  const paletteIndex = postBgPaletteIndex(bg);
  const setColors = (colors: PostBgPalette) => { if (base) setColorsById((m) => ({ ...m, [base.id]: colors })); };
  const setOne = (value: string) => {
    if (!bg?.colors) return;
    const next = [...bg.colors] as [string, string, string];
    next[well] = value;
    setColors(next);
  };

  const save = async () => {
    const colors = bg && bg.palettes.length ? bg.colors ?? null : null;
    const unchanged = !photo && (current?.id ?? null) === sel && (current?.colors ?? []).join() === (bg?.colors ?? []).join();
    if (unchanged && !(scope === "all" && postId)) { closePostBgPicker(); return; }
    if (sel === POST_BG_PHOTO_ID && !photoSrc) return;
    setSaving(true);
    try {
      if (scope === "post" && postId) {
        const upload = sel === POST_BG_PHOTO_ID && photo
          ? (postBgIsVideo(photo) ? createRNVideoFile(photo, "postbg") : createRNImageFile(photo, "postbg"))
          : null;
        // A picture already on the profile (or this post) is reused by its key.
        const stored = sel === POST_BG_PHOTO_ID
          ? (upload ? POST_BG_PHOTO_ID : postBgPhotoStored(photoSrc))
          : postBgStored(sel, colors);
        if (stored === null) {
          toastError(null, t("postBg.saveFailed", "Couldn't save your background. Try again."));
          return;
        }
        const saved = await setPostBackground(postId, stored, upload ?? undefined);
        setPostBgForPost(postId, saved ? postBgFromStored(saved) ?? picked : null);
        closePostBgPicker();
        return;
      }
      // Merge into the account's latest customs, not a cached copy, so a
      // setting saved on another device is never written back over.
      let customsBase: Record<string, unknown> = user?.customs ?? {};
      try {
        const res: any = await getAccount(user?.username || address);
        const core = res?.data?.result || res?.result;
        if (core?.customs && typeof core.customs === "object") customsBase = core.customs;
      } catch { /* use the cached copy */ }
      const merged = mergePostBg(customsBase, { id: sel, colors });
      const upload = sel === POST_BG_PHOTO_ID && photo
        ? (postBgIsVideo(photo) ? createRNVideoFile(photo, "postbg") : createRNImageFile(photo, "postbg"))
        : null;
      await AuthService.updateProfile({ customs: JSON.stringify(merged), ...(upload ? { postBgImg: upload } : {}) });
      if (address) setPostBgOverride(address, picked);
      // All posts: drop every post's own backdrop so they all follow this one.
      // (Only when chosen from a held post: the header just sets the profile's.)
      if (postId) {
        await setPostBackground("all", "");
        if (address) clearAllPostBgs(address);
      }
      patchUser({ customs: merged as Record<string, string> } as any).catch(() => {});
      closePostBgPicker();
    } catch (error) {
      logger.error("Post background save failed", error);
      toastError(error, t("postBg.saveFailed", "Couldn't save your background. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const ink = shown ? POST_BG_INK[shown.tone] : POST_BG_INK.dark;
  const pad = width / 2 - TILE / 2;
  const avatar = user?.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl, 72) : undefined;
  const kindLabel = (b: PostBg) => (b.kind === "moving" ? t("postBg.moving", "Moving") : b.kind === "photo" ? t("postBg.yours", "Yours") : t("postBg.still", "Still"));
  const wellLabels = [t("postBg.base", "Base"), t("postBg.accent", "Accent"), t("postBg.accent2", "Accent 2")];
  const canSave = !saving && !(sel === POST_BG_PHOTO_ID && !photoSrc);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closePostBgPicker} statusBarTranslucent>
      <ProfilePostBgArtContext.Provider value={avatar && /^https?:/.test(avatar) ? avatar : null}>
      <View className="dark-surface" style={[styles.panel, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.top}>
          <Pressable onPress={closePostBgPicker} hitSlop={10} style={styles.topBtn} accessibilityRole="button">
            <Text style={styles.topText}>{t("common.cancel", "Cancel")}</Text>
          </Pressable>
          <Text style={styles.title}>{t("postBg.title", "Post background")}</Text>
          <Pressable onPress={save} disabled={!canSave} hitSlop={10} style={[styles.topBtn, styles.done, !canSave && { opacity: 0.5 }]} accessibilityRole="button">
            {saving ? <ActivityIndicator size="small" color="#0b0b0f" /> : <Text style={styles.doneText}>{t("common.done", "Done")}</Text>}
          </Pressable>
        </View>

        {postId && (
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t("postBg.scope")}>
            {(["post", "all"] as const).map((s) => (
              <Pressable key={s} onPress={() => changeScope(s)} disabled={saving} style={[styles.chip, scope === s && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: scope === s }}>
                <Text style={styles.chipText}>{s === "post" ? t("postBg.thisPost") : t("postBg.allPosts")}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.stage}>
          <View style={[styles.preview, !shown && styles.previewPlain]}>
            <PostBgLayer bg={shown} />
            <View style={styles.who}>
              <Avatar uri={avatar} name={user?.displayName || user?.username} size={36} radius={18} />
              <View>
                <Text style={[styles.name, { color: ink.ink }]}>{user?.displayName || user?.username || ""}</Text>
                {!!user?.username && <Text style={[styles.handle, { color: ink.sub }]}>@{user.username}</Text>}
              </View>
            </View>
            <Text numberOfLines={6} style={[styles.words, { color: ink.ink }]}>
              {sampleText?.trim() || t("postBg.sample", "This is how your text posts look on your profile.")}
            </Text>
          </View>
        </View>

        <View style={styles.label} accessibilityLiveRegion="polite">
          <Text style={styles.labelName}>{bg ? t(`postBg.names.${bg.id}`, bg.name) : followsProfile ? t("postBg.sameAsProfile") : t("postBg.none", "None")}</Text>
          <Text style={styles.labelSub}>{bg ? kindLabel(bg) : followsProfile ? t("postBg.sameAsProfileSub") : t("postBg.plain", "Plain posts")}</Text>
        </View>

        <View style={styles.colors}>
          {bg && bg.palettes.length > 0 && (
            <>
              <View style={styles.colorRow} accessibilityRole="radiogroup">
                {bg.palettes.map((p, i) => (
                  <Pressable key={i} onPress={() => { setColors(p); setCustomOpen(false); }} hitSlop={4} accessibilityRole="radio" accessibilityState={{ checked: paletteIndex === i }}
                    style={[styles.colorRing, paletteIndex === i && !customOpen && styles.colorRingOn]}>
                    <View style={[styles.color, { backgroundColor: p[0] }]}>
                      <View style={[styles.colorHalf, { backgroundColor: p[1] }]} />
                      <View style={[styles.colorDot, { backgroundColor: p[2] }]} />
                    </View>
                  </Pressable>
                ))}
                <Pressable onPress={() => setCustomOpen((v) => !v)} hitSlop={4} accessibilityRole="radio" accessibilityLabel={t("postBg.ownColours", "Your own colours")}
                  accessibilityState={{ checked: customOpen || paletteIndex === -1 }} style={[styles.colorRing, (customOpen || paletteIndex === -1) && styles.colorRingOn]}>
                  <View style={[styles.color, styles.colorOwn]}><Text style={styles.colorPlus}>+</Text></View>
                </Pressable>
              </View>
              {customOpen && bg.colors && (
                <View style={styles.own}>
                  <View style={styles.wells}>
                    {wellLabels.map((label, i) => (
                      <Pressable key={i} onPress={() => setWell(i)} style={styles.well} accessibilityRole="button" accessibilityState={{ selected: well === i }}>
                        <View style={[styles.wellDot, { backgroundColor: bg.colors![i] }, well === i && styles.wellDotOn]} />
                        <Text style={[styles.wellText, well === i && { opacity: 1 }]}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <FlatList
                    horizontal
                    data={SWATCHES}
                    keyExtractor={(c) => c}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
                    renderItem={({ item }) => (
                      <Pressable onPress={() => setOne(item)} hitSlop={3} accessibilityRole="button" accessibilityLabel={item}
                        style={[styles.swatchPick, { backgroundColor: item }, bg.colors![well] === item && styles.swatchPickOn]} />
                    )}
                  />
                </View>
              )}
            </>
          )}
          {bg?.kind === "photo" && (
            <Pressable onPress={choosePhoto} style={styles.photoBtn} accessibilityRole="button">
              <Text style={styles.photoBtnText}>{photoSrc ? t("postBg.changeMedia") : t("postBg.addMedia")}</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.chips}>
          {([
            [POST_BG_PHOTO_ID, t("postBg.yours", "Yours"), bg?.kind === "photo"],
            [MOVING_BGS[0].id, `${t("postBg.moving", "Moving")} · ${MOVING_BGS.length}`, bg?.kind === "moving"],
            [STILL_BGS[0].id, `${t("postBg.still", "Still")} · ${STILL_BGS.length}`, bg?.kind === "still"],
          ] as const).map(([id, label, on]) => (
            <Pressable key={id} onPress={() => jump(id)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!on }}>
              <Text style={styles.chipText}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <FlatList
          ref={listRef}
          horizontal
          data={ORDER}
          keyExtractor={(b) => b?.id ?? "none"}
          showsHorizontalScrollIndicator={false}
          snapToInterval={STEP}
          decelerationRate="fast"
          style={styles.strip}
          contentContainerStyle={{ paddingHorizontal: pad, gap: GAP }}
          getItemLayout={(_, i) => ({ length: STEP, offset: STEP * i, index: i })}
          onMomentumScrollEnd={settle}
          onScrollEndDrag={settle}
          initialNumToRender={12}
          windowSize={5}
          renderItem={({ item, index }) => {
            const on = (item?.id ?? null) === sel;
            const look = !item ? null : item.kind === "photo" ? (photoSrc ? { ...item, image: photoSrc } : null) : colorsById[item.id] ? withPostBgColors(item, colorsById[item.id]) : item;
            const empty = !item || (item.kind === "photo" && !photoSrc);
            return (
              <Pressable onPress={() => pick(index)} style={styles.tile} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <View style={[styles.swatch, empty && styles.swatchNone, on && styles.swatchOn]}>
                  {item?.kind === "photo" && !photoSrc ? <Text style={styles.addPlus}>+</Text> : <PostBgLayer bg={look} active={on} />}
                </View>
                <Text numberOfLines={1} style={styles.tileText}>{item ? t(`postBg.names.${item.id}`, item.name) : scope === "post" ? t("postBg.sameAsProfile") : t("postBg.none", "None")}</Text>
              </Pressable>
            );
          }}
        />
      </View>
      </ProfilePostBgArtContext.Provider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: "#0b0b0f", paddingHorizontal: 16, gap: 12 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, minWidth: 64, alignItems: "center" },
  topText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  done: { backgroundColor: "#FFFFFF" },
  doneText: { color: "#0b0b0f", fontSize: 15, fontWeight: "800" },
  stage: { flex: 1, justifyContent: "center" },
  preview: { borderRadius: 18, overflow: "hidden", padding: 16, gap: 12, minHeight: 200 },
  previewPlain: { borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
  who: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { fontSize: 14, fontWeight: "800" },
  handle: { fontSize: 12.5 },
  words: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  label: { alignItems: "center", gap: 2 },
  labelName: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  labelSub: { color: "rgba(255,255,255,0.62)", fontSize: 12 },
  strip: { flexGrow: 0 },
  tile: { width: TILE, alignItems: "center", gap: 4 },
  swatch: { width: TILE, height: TILE, borderRadius: 14, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
  swatchNone: { borderStyle: "dashed", borderColor: "rgba(255,255,255,0.5)" },
  swatchOn: { borderColor: "#FFFFFF" },
  addPlus: { color: "#FFFFFF", fontSize: 24, fontWeight: "600", textAlign: "center", lineHeight: 50 },
  colors: { alignItems: "center", gap: 10, minHeight: 40 },
  colorRow: { flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap" },
  colorRing: { padding: 2, borderRadius: 22, borderWidth: 2, borderColor: "transparent" },
  colorRingOn: { borderColor: "#FFFFFF" },
  color: { width: 32, height: 32, borderRadius: 16, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.35)" },
  colorHalf: { position: "absolute", left: 0, top: 0, bottom: 0, width: 16 },
  colorDot: { position: "absolute", width: 10, height: 10, borderRadius: 5, left: 11, top: 11 },
  colorOwn: { backgroundColor: "#7b61ff", alignItems: "center", justifyContent: "center" },
  colorPlus: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", lineHeight: 20 },
  own: { alignSelf: "stretch", gap: 10 },
  wells: { flexDirection: "row", justifyContent: "center", gap: 22 },
  well: { alignItems: "center", gap: 4 },
  wellDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  wellDotOn: { borderWidth: 3, borderColor: "#FFFFFF" },
  wellText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700", opacity: 0.6 },
  swatchPick: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.4)" },
  swatchPickOn: { borderWidth: 3, borderColor: "#FFFFFF" },
  photoBtn: { backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  photoBtnText: { color: "#0b0b0f", fontSize: 14, fontWeight: "800" },
  chips: { flexDirection: "row", gap: 8, justifyContent: "center" },
  chip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: "rgba(255,255,255,0.18)" },
  chipText: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "700" },
  tileText: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "700", maxWidth: 64 },
  hint: { color: "rgba(255,255,255,0.55)", fontSize: 12, textAlign: "center" },
});
