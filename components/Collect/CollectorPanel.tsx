/**
 * The collector side of a minted post: copies, the creator's resale royalty
 * and the extras only owners can open. The creator manages the note and files
 * here too. Port of web's CollectorPanel.
 */
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Linking, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import Icon, { type IconName } from "../ui/Icon";
import { toastError, toastSuccess } from "../../libs/toast";
import { formatCount } from "../../libs/format-count";
import { DIGITAL_PURCHASES_ENABLED } from "../../config/storefront";
import { bpsLabel, collect, uploadUnlockableFile, type Unlockable, type UnlockableFile } from "../../services/collect.service";

const KIND_ICON: Record<UnlockableFile["kind"], IconName> = { image: "Image", video: "Video", audio: "Music", file: "Paperclip" };
const fileSize = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

/** Copies of a post, from the editions API. Null before it loads. */
export function useEditionSupply(tokenId: number | string | undefined) {
  const id = tokenId == null ? "" : String(tokenId);
  return useQuery({
    queryKey: ["edition", id],
    queryFn: async () => (await collect.editions([id])).items?.[id] ?? null,
    enabled: !!id,
    staleTime: 60_000,
  });
}

export default function CollectorPanel({ tokenId }: { tokenId: number | string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const edition = useEditionSupply(tokenId);
  const unlock = useQuery({
    queryKey: ["unlockable", String(tokenId)],
    queryFn: () => collect.unlockable(tokenId),
    staleTime: 30 * 60_000,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const data = unlock.data;
  const supply = edition.data?.supply;
  const royaltyBps = edition.data?.royaltyBps ?? 0;
  const isCreator = !!data?.isCreator;
  const showExtras = isCreator || !!data?.has;
  if (supply == null && !showExtras) return null;

  const setData = (next: Unlockable) => {
    qc.setQueryData(["unlockable", String(tokenId)], next);
    void qc.invalidateQueries({ queryKey: ["edition", String(tokenId)] });
  };
  const run = async (label: string, fn: () => Promise<Unlockable | void>, done?: string) => {
    setBusy(label);
    try {
      const next = await fn();
      if (next) setData(next);
      if (done) toastSuccess(done);
    } catch (e) {
      toastError((e as Error)?.message || t("collect.saveFailed", { defaultValue: "Could not save" }));
    } finally {
      setBusy(null);
    }
  };

  const addFile = () => run("upload", async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const a = picked.assets[0];
    if ((a.size ?? 0) > 100_000_000) throw new Error(t("collect.fileTooBig", { name: a.name, defaultValue: "{{name}} is over 100 MB" }));
    return uploadUnlockableFile(tokenId, { uri: a.uri, name: a.name, mimeType: a.mimeType });
  });

  return (
    <View style={styles.section} testID="collector-panel">
      <View style={styles.pills}>
        {supply != null ? (
          <Text style={styles.pill}>
            {supply === 1 ? t("collect.oneOfOne", { defaultValue: "1 of 1" }) : t("collect.copiesPill", { copies: formatCount(supply), defaultValue: "{{copies}} copies" })}
          </Text>
        ) : null}
        {royaltyBps > 0 ? (
          <Text style={styles.pill}>{t("collect.royaltyPill", { pct: bpsLabel(royaltyBps), defaultValue: "{{pct}} to the creator on resales" })}</Text>
        ) : null}
        {data?.has ? <Text style={[styles.pill, styles.pillGold]}>{t("collect.ownerExtrasPill", { defaultValue: "Owner extras" })}</Text> : null}
      </View>

      {showExtras && data ? (
        <View style={{ gap: 10 }}>
          <View style={styles.row}>
            <Icon name={data.canOpen ? "LockOpen" as IconName : "Lock"} size={16} color="rgba(255,255,255,0.7)" />
            <Text style={styles.title}>{t("collect.extrasTitle", { defaultValue: "Only for owners" })}</Text>
          </View>

          {!data.canOpen && DIGITAL_PURCHASES_ENABLED ? (
            <Text style={styles.muted}>
              {t("collect.lockedSummary", {
                what: [
                  data.summary.files > 0 ? t("collect.nFiles", { n: formatCount(data.summary.files), defaultValue: "{{n}} files" }) : null,
                  data.summary.hasText ? t("collect.aNote", { defaultValue: "a note from the creator" }) : null,
                ].filter(Boolean).join(" + "),
                defaultValue: "Collect a copy to open {{what}}.",
              })}
            </Text>
          ) : null}

          {data.canOpen && !isCreator && data.text ? <Text style={styles.note}>{data.text}</Text> : null}

          {isCreator ? (
            <View style={{ gap: 8 }}>
              <TextInput
                value={draft ?? data.text ?? ""}
                onChangeText={(v) => setDraft(v.slice(0, 5000))}
                multiline
                placeholder={t("collect.notePlaceholder", { defaultValue: "A note, link or code only owners see" })}
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={styles.input}
              />
              {draft != null && draft !== (data.text ?? "") ? (
                <Pressable
                  onPress={() => run("text", async () => { const next = await collect.saveText(tokenId, draft); setDraft(null); return next; }, t("collect.extrasSaved", { defaultValue: "Saved for owners" }))}
                  style={styles.btn}
                  accessibilityRole="button"
                >
                  {busy === "text" ? <ActivityIndicator size="small" color="#000" /> : null}
                  <Text style={styles.btnText}>{t("collect.saveNote", { defaultValue: "Save note" })}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {data.canOpen
            ? data.files.map((f) => (
              <View key={f.id} style={styles.fileRow}>
                {f.kind === "image" && f.url ? (
                  <Image source={{ uri: f.url }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbIcon]}><Icon name={KIND_ICON[f.kind] ?? "Paperclip"} size={18} color="rgba(255,255,255,0.7)" /></View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.value} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.faint}>{fileSize(f.size)}</Text>
                </View>
                {f.url ? (
                  <Pressable onPress={() => { void Linking.openURL(f.url!); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("collect.download", { defaultValue: "Download" })}>
                    <Icon name="Download" size={18} color="rgba(255,255,255,0.8)" />
                  </Pressable>
                ) : null}
                {isCreator ? (
                  <Pressable onPress={() => run(`rm:${f.id}`, () => collect.removeFile(tokenId, f.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("collect.removeFile", { defaultValue: "Remove file" })}>
                    <Icon name="Trash" size={18} color="rgba(255,255,255,0.5)" />
                  </Pressable>
                ) : null}
              </View>
            ))
            : null}

          {isCreator && data.files.length < 10 ? (
            <Pressable onPress={addFile} disabled={!!busy} style={styles.addFile} accessibilityRole="button">
              {busy === "upload" ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="Paperclip" size={16} color="rgba(255,255,255,0.7)" />}
              <Text style={styles.muted}>{t("collect.addFile", { defaultValue: "Add a picture, video, song or any file (100 MB max)" })}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { color: "#FFFFFF", fontSize: 12, fontWeight: "500", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.1)", overflow: "hidden" },
  pillGold: { color: "#FDE68A", backgroundColor: "rgba(251,191,36,0.15)" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: "600" },
  value: { color: "#FFFFFF", fontSize: 14 },
  muted: { color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 18, flexShrink: 1 },
  faint: { color: "rgba(255,255,255,0.4)", fontSize: 12 },
  note: { color: "#FFFFFF", fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.2)" },
  input: { color: "#FFFFFF", fontSize: 14, minHeight: 72, textAlignVertical: "top", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(0,0,0,0.3)", padding: 12 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FFFFFF" },
  btnText: { color: "#000000", fontSize: 14, fontWeight: "600" },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 8, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.2)" },
  thumb: { width: 40, height: 40, borderRadius: 8 },
  thumbIcon: { backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  addFile: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.2)" },
});
