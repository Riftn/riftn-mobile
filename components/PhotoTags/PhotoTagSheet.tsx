import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, Pressable, Image, TextInput, ScrollView, ActivityIndicator, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { mentionSearch, type MentionUser } from "../../services/mention.service";
import type { PhotoTag } from "../../services/photo-tags.service";

const MAX_TAGS = 20;

interface Props {
  visible: boolean;
  images: string[];
  initialTags: PhotoTag[];
  onClose: () => void;
  /** Saves the tags; the sheet closes once this resolves. */
  onDone: (tags: PhotoTag[]) => Promise<void> | void;
}

/**
 * Tap the photo where someone is, then pick their name. Works on every photo
 * of the post (arrows step through them). Up to 20 people per photo.
 */
const PhotoTagSheet: React.FC<Props> = ({ visible, images, initialTags, onClose, onDone }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [tags, setTags] = useState<PhotoTag[]>(initialTags);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MentionUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [ratio, setRatio] = useState(1);
  const searchSeq = useRef(0);

  useEffect(() => { if (visible) { setTags(initialTags); setIndex(0); setSpot(null); setQuery(""); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const uri = images[index];
  useEffect(() => {
    if (!uri) return;
    Image.getSize(uri, (w, h) => { if (w > 0 && h > 0) setRatio(w / h); }, () => setRatio(1));
  }, [uri]);

  useEffect(() => {
    const q = query.trim().replace(/^@/, "");
    if (!q) { setResults([]); return; }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      mentionSearch(q).then((rows) => {
        if (seq === searchSeq.current) setResults(rows.filter((r) => (r.kind ?? "user") === "user").slice(0, 8));
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const boxW = width;
  const boxH = Math.min(boxW / ratio, height * 0.5);
  const imgW = Math.min(boxW, boxH * ratio);
  const onPhoto = useMemo(() => tags.filter((tag) => tag.i === index), [tags, index]);

  const place = (e: any) => {
    const { locationX, locationY } = e.nativeEvent;
    if (onPhoto.length >= MAX_TAGS) return;
    setSpot({ x: Math.max(0, Math.min(1, locationX / imgW)), y: Math.max(0, Math.min(1, locationY / boxH)) });
  };

  const pickUser = (user: MentionUser) => {
    if (!spot) return;
    setTags((prev) => [
      ...prev.filter((tag) => !(tag.i === index && tag.username.toLowerCase() === user.username.toLowerCase())),
      { username: user.username, address: user.address, i: index, x: spot.x, y: spot.y },
    ]);
    setSpot(null);
    setQuery("");
  };

  const done = async () => {
    setSaving(true);
    try {
      await onDone(tags);
      onClose();
    } catch {
      // The caller says what went wrong; keep the sheet open to try again.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,1)", paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, height: 52 }}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.close")}>
            <Icon name="X" size={22} color="rgba(255,255,255,1)" />
          </Pressable>
          <Text style={{ color: "rgba(255,255,255,1)", fontSize: 16, fontWeight: "600" }}>{t("photoTags.title")}</Text>
          <Pressable onPress={done} disabled={saving} hitSlop={10} accessibilityRole="button">
            {saving ? <ActivityIndicator size="small" color="rgba(255,255,255,1)" /> : <Text style={{ color: "rgba(255,255,255,1)", fontSize: 15, fontWeight: "600" }}>{t("photoTags.done")}</Text>}
          </Pressable>
        </View>

        <View style={{ width: boxW, height: boxH, alignItems: "center", justifyContent: "center" }}>
          <Pressable onPress={place} style={{ width: imgW, height: boxH }}>
            {!!uri && <Image source={{ uri }} style={{ width: imgW, height: boxH }} resizeMode="cover" />}
            {onPhoto.map((tag) => (
              <View key={tag.username} pointerEvents="none" style={{ position: "absolute", left: tag.x * imgW, top: tag.y * boxH, transform: [{ translateX: -40 }], width: 80, alignItems: "center" }}>
                <View style={{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.75)" }}>
                  <Text numberOfLines={1} style={{ color: "rgba(255,255,255,1)", fontSize: 12, fontWeight: "600" }}>@{tag.username}</Text>
                </View>
              </View>
            ))}
            {spot && (
              <View pointerEvents="none" style={{ position: "absolute", left: spot.x * imgW - 10, top: spot.y * boxH - 10, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "rgba(255,255,255,1)", backgroundColor: "rgba(0,0,0,0.4)" }} />
            )}
          </Pressable>
          {images.length > 1 && (
            <>
              {index > 0 && (
                <Pressable onPress={() => { setIndex(index - 1); setSpot(null); }} hitSlop={8} style={{ position: "absolute", left: 8 }} accessibilityRole="button">
                  <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" }}>
                    <Icon name="ChevronLeft" size={18} color="rgba(255,255,255,1)" />
                  </View>
                </Pressable>
              )}
              {index < images.length - 1 && (
                <Pressable onPress={() => { setIndex(index + 1); setSpot(null); }} hitSlop={8} style={{ position: "absolute", right: 8 }} accessibilityRole="button">
                  <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" }}>
                    <Icon name="ChevronRight" size={18} color="rgba(255,255,255,1)" />
                  </View>
                </Pressable>
              )}
            </>
          )}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, gap: 10 }}>
          {spot ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", paddingHorizontal: 12, height: 44 }}>
              <Icon name="Search" size={16} color="rgba(255,255,255,0.6)" />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder={t("photoTags.search")}
                placeholderTextColor="rgba(255,255,255,0.4)"
                autoCapitalize="none"
                autoCorrect={false}
                style={{ flex: 1, color: "rgba(255,255,255,1)", fontSize: 15 }}
              />
            </View>
          ) : (
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>{t("photoTags.hint")}</Text>
          )}
          {spot && results.map((user) => (
            <Pressable key={user.address || user.username} onPress={() => pickUser(user)} accessibilityRole="button">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
                {user.avatarImageUrl
                  ? <Image source={{ uri: user.avatarImageUrl }} style={{ width: 32, height: 32, borderRadius: 16 }} />
                  : <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.1)" }} />}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: "rgba(255,255,255,1)", fontSize: 14, fontWeight: "600" }}>{user.displayName || user.username}</Text>
                  <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>@{user.username}</Text>
                </View>
              </View>
            </Pressable>
          ))}
          {!spot && onPhoto.map((tag) => (
            <View key={tag.username} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 }}>
              <Text style={{ color: "rgba(255,255,255,1)", fontSize: 14 }}>@{tag.username}</Text>
              <Pressable
                onPress={() => setTags((prev) => prev.filter((x) => !(x.i === index && x.username === tag.username)))}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t("photoTags.remove")}
              >
                <Icon name="X" size={16} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
};

export default PhotoTagSheet;
