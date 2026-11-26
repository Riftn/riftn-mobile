import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "../ui/Icon";
import { useAppTheme } from "../../context/ThemeContext";
import { SEARCH_INPUT_CLEAR, useSearchFieldMaterial } from "../../hooks/useSearchFieldMaterial";
import { searchFreeAssets, searchFreeCoverPhotos, type FreeAsset } from "../../libs/editor/freeAssets";
import { toastError } from "../../libs/toast";

export interface FreeImagePick {
  uri: string;
  width: number;
  height: number;
  fileName: string;
  mimeType: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Starting search, usually the first words of the post. */
  initialQuery?: string;
  /** Article covers and their link previews have no credit field. */
  forArticleCover?: boolean;
  /** The downloaded photo plus its credit line when the owner asks for one. */
  onPick: (image: FreeImagePick, credit: string | null) => void;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const SEARCH_INSET = 12;
const SEARCH_ICON_SIZE = 16;
const SEARCH_GAP = 8;

/**
 * Free photo search for a post: the same open library the editor uses, so a
 * picture can go next to a post without being in the phone's gallery first.
 */
export default function FreeImagesSheet({ visible, onClose, initialQuery, forArticleCover = false, onPick }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { colors: themeColors } = useAppTheme();
  const searchField = useSearchFieldMaterial();
  const searchLabel = t("freeImages.search");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [items, setItems] = useState<FreeAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const selectionRef = useRef<symbol | null>(null);

  useEffect(() => () => { selectionRef.current = null; }, [visible]);

  const close = () => {
    selectionRef.current = null;
    setPicking(null);
    onClose();
  };

  useEffect(() => {
    if (!visible) return;
    const start = (initialQuery || "").replace(/https?:\/\/\S+/g, "").replace(/[#@]\S+/g, "").trim().split(/\s+/).slice(0, 4).join(" ");
    setItems([]);
    setQuery(start);
    setSubmitted(start || "nature");
  }, [visible, initialQuery]);

  useEffect(() => {
    if (!visible || !submitted) return;
    const controller = new AbortController();
    setLoading(true);
    const results = forArticleCover
      ? searchFreeCoverPhotos(submitted, controller.signal)
      : searchFreeAssets({ kind: "photo", query: submitted, signal: controller.signal })
        .then(result => result.items.filter(asset => /^image\/(jpeg|png|webp)/.test(asset.mimeType) || !asset.mimeType));
    results
      .then(photos => { if (!controller.signal.aborted) setItems(photos); })
      .catch(() => { if (!controller.signal.aborted) setItems([]); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [visible, submitted, forArticleCover]);

  const pick = async (asset: FreeAsset) => {
    if (selectionRef.current) return;
    const selection = Symbol();
    selectionRef.current = selection;
    setPicking(asset.id);
    try {
      const mime = (asset.mimeType || "image/jpeg").split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg");
      const ext = EXT[mime] || "jpg";
      const target = `${FileSystem.cacheDirectory}free-image-${Date.now()}.${ext}`;
      const res = await FileSystem.downloadAsync(asset.downloadUrl, target);
      if (selection !== selectionRef.current) {
        void FileSystem.deleteAsync(res.uri, { idempotent: true }).catch(() => {});
        return;
      }
      if (res.status < 200 || res.status >= 300) throw new Error(`download ${res.status}`);
      const credit = asset.attributionRequired && asset.creator
        ? t("freeImages.credit", { creator: asset.creator, license: asset.license })
        : null;
      onPick({ uri: res.uri, width: asset.width || 1080, height: asset.height || 1080, fileName: `free-image.${ext}`, mimeType: mime }, credit);
      close();
    } catch {
      if (selection === selectionRef.current) toastError(t("freeImages.failed"));
    } finally {
      if (selection === selectionRef.current) {
        selectionRef.current = null;
        setPicking(null);
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel={t("common.close", { defaultValue: "Close" })} />
        <View style={{ height: height * 0.78, backgroundColor: themeColors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: themeColors.border, paddingBottom: insets.bottom }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: "600", color: themeColors.foreground }}>{t("freeImages.title")}</Text>
            <TouchableOpacity onPress={close} hitSlop={11} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
              <Icon name="X" size={22} color={themeColors.foreground} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchSection}>
            <View style={[styles.searchRow, searchField.surface]}>
              <Icon name="Search" size={SEARCH_ICON_SIZE} color={themeColors.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={searchLabel}
                accessibilityLabel={searchLabel}
                placeholderTextColor={themeColors.mutedForeground}
                returnKeyType="search"
                onFocus={searchField.onFocus}
                onBlur={searchField.onBlur}
                onSubmitEditing={() => { if (query.trim()) setSubmitted(query.trim()); }}
                style={[styles.searchInput, SEARCH_INPUT_CLEAR, { color: themeColors.foreground }]}
              />
            </View>
            {!forArticleCover && <Text style={[styles.searchNote, { color: themeColors.mutedForeground }]}>{t("freeImages.note")}</Text>}
          </View>
          {loading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={themeColors.foreground} /></View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(a) => a.id}
              numColumns={3}
              contentContainerStyle={{ padding: 12 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={{ textAlign: "center", marginTop: 40, color: themeColors.mutedForeground }}>{t("freeImages.empty")}</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => pick(item)}
                  disabled={!!picking}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                  style={{ flex: 1 / 3, aspectRatio: 1, padding: 4, opacity: picking && picking !== item.id ? 0.5 : 1 }}
                >
                  <View style={{ flex: 1, borderRadius: 12, overflow: "hidden", backgroundColor: "hsla(0,0%,50%,0.12)" }}>
                    <Image source={{ uri: item.thumbnailUrl }} style={{ flex: 1 }} contentFit="cover" />
                    {picking === item.id && (
                      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "hsla(0,0%,0%,0.5)" }}>
                        <ActivityIndicator color="#fff" />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  searchSection: { paddingHorizontal: 16, gap: 8 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SEARCH_GAP,
    borderRadius: 12,
    paddingHorizontal: SEARCH_INSET,
  },
  searchInput: { flex: 1, minHeight: 44, paddingHorizontal: 0, fontSize: 15 },
  searchNote: { paddingStart: SEARCH_INSET + SEARCH_ICON_SIZE + SEARCH_GAP, fontSize: 13, lineHeight: 18 },
});
