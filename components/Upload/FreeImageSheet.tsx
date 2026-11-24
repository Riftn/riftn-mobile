/**
 * Free image — pictures for a post from what its caption says
 * ============================================================
 * Searches the same open libraries the video editor uses (Openverse,
 * Wikimedia Commons and the stock providers behind free-stock-assets), so
 * everything offered may be reposted. Google Images is not a source on
 * purpose: those pictures belong to whoever made them.
 *
 * @module components/Upload/FreeImageSheet
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import * as FileSystem from "expo-file-system/legacy";
import { useTranslation } from "react-i18next";

import GlassModal from "../ui/GlassModal";
import Icon from "../ui/Icon";
import { useAppTheme } from "../../context/ThemeContext";
import { captionQuery, licenceLabel } from "../../libs/caption-query";
import { searchFreeAssets, type FreeAsset } from "../../libs/editor/freeAssets";
import { toastError } from "../../libs/toast";

export interface FreePicture {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The post's caption: the first search is for what it is about. */
  caption: string;
  onPick: (picture: FreePicture, asset: FreeAsset) => void;
}

const EXT: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/gif": "gif" };

const FreeImageSheet: React.FC<Props> = ({ visible, onClose, caption, onPick }) => {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<FreeAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tile = Math.floor((Math.min(width, 520) - 32 - 16) / 3);

  const run = useCallback((q: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    searchFreeAssets({ kind: "photo", query: q, signal: ctrl.signal })
      .then((res) => {
        if (ctrl.signal.aborted) return;
        // Phones cannot post an SVG; everything else here is a photo format.
        setItems(res.items.filter((a) => a.thumbnailUrl && /^image\/(jpe?g|png|webp|gif)/i.test(a.mimeType || "image/jpeg")));
      })
      .catch(() => { if (!ctrl.signal.aborted) setItems([]); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    if (!visible) { abortRef.current?.abort(); return; }
    const q = captionQuery(caption);
    setQuery(q);
    setItems([]);
    run(q);
    // Opening is the trigger; the caption is read once at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pick = async (asset: FreeAsset) => {
    if (picking) return;
    setPicking(asset.id);
    const mime = (asset.mimeType || "image/jpeg").split(";")[0].toLowerCase();
    const ext = EXT[mime] ?? "jpg";
    const tmp = `${FileSystem.cacheDirectory ?? ""}free-image-${Date.now()}.${ext}`;
    try {
      const dl = await FileSystem.downloadAsync(asset.downloadUrl, tmp);
      if (dl.status < 200 || dl.status >= 300) throw new Error(`download ${dl.status}`);
      onPick({ uri: dl.uri, width: asset.width ?? 1080, height: asset.height ?? 1080, mimeType: mime, fileName: `free-image-${Date.now()}.${ext}` }, asset);
      onClose();
    } catch {
      toastError(t("freeImage.failed"));
    } finally {
      setPicking(null);
    }
  };

  return (
    <GlassModal visible={visible} onClose={onClose} presentation="bottom" scrollable>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 10 }}>
        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{t("freeImage.title")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 12 }}>
          <Icon name="Search" size={16} color="rgba(255,255,255,0.6)" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => run(query.trim())}
            returnKeyType="search"
            placeholder={t("freeImage.search")}
            placeholderTextColor="rgba(255,255,255,0.4)"
            accessibilityLabel={t("freeImage.search")}
            style={{ flex: 1, height: 40, color: colors.foreground, fontSize: 14 }}
          />
        </View>
        <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{t("freeImage.hint")}</Text>
        {loading && items.length === 0 ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}><ActivityIndicator color="#fff" /></View>
        ) : items.length === 0 ? (
          <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, textAlign: "center", paddingVertical: 40 }}>{t("freeImage.none")}</Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, opacity: loading ? 0.6 : 1 }}>
            {items.map((asset) => (
              <Pressable
                key={asset.id}
                onPress={() => void pick(asset)}
                disabled={!!picking}
                accessibilityRole="button"
                accessibilityLabel={asset.title}
                style={{ width: tile, height: tile, borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.05)" }}
              >
                <Image source={{ uri: asset.thumbnailUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} />
                <Text numberOfLines={1} style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingVertical: 3, fontSize: 10, color: "rgba(255,255,255,0.85)", backgroundColor: "rgba(0,0,0,0.45)" }}>
                  {licenceLabel(asset.license)}
                </Text>
                {picking === asset.id && (
                  <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)" }}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </GlassModal>
  );
};

export default FreeImageSheet;
