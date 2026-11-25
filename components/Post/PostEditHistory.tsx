/**
 * A post's edit history, on Post Info.
 *
 * One quiet line in the Content card ("Edited 3 times") that opens a sheet
 * where the reader steps through the versions: Original, each edit, and the
 * post as it reads now. Renders nothing for a post that was never edited.
 *
 * The server keeps the words an edit replaced from the day this shipped, so a
 * post edited before then has no history to show.
 */
import React, { useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import Icon from "../ui/Icon";
import GlassModal from "../ui/GlassModal";
import CustomSwitch from "../ui/CustomSwitch";
import { getPostEditHistory, type PostVersion } from "../../services/nft.service";
import { formatShortAgo } from "../../libs/date.util";
import { diffWords } from "../../libs/post-edit-diff";

const Marked: React.FC<{ before: string; after: string }> = ({ before, after }) => {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <>
      {parts.map((part, index) => (
        <Text key={index} style={part.type === "add" ? styles.added : part.type === "del" ? styles.removed : undefined}>
          {part.text}
        </Text>
      ))}
    </>
  );
};

function versionLabel(t: TFunction, version: PostVersion, index: number): string {
  if (version.current) return t("postEditHistory.now");
  if (index === 0) return t("postEditHistory.original");
  return t("postEditHistory.editN", { n: index });
}

/** The version stepper on its own. */
export const PostEditHistoryViewer: React.FC<{ versions: PostVersion[] }> = ({ versions }) => {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState(Math.max(0, versions.length - 1));
  const [showChanges, setShowChanges] = useState(true);
  const index = Math.min(selected, versions.length - 1);
  const version = versions[index];
  const previous = index > 0 ? versions[index - 1] : null;
  if (!version) return null;

  const when = version.at
    ? new Date(version.at).toLocaleString(i18n.language?.replace('_', '-') || undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";
  const marks = showChanges && !!previous;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.steps}>
        {versions.map((item, i) => {
          const active = i === index;
          return (
            <Pressable
              key={i}
              onPress={() => setSelected(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.step, active && styles.stepActive]}
            >
              <Text style={[styles.stepText, active && styles.stepTextActive]}>{versionLabel(t, item, i)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.version}>
        {!!when && <Text style={styles.when}>{when}</Text>}
        {!!(version.name || (marks && previous?.name)) && (
          <Text style={styles.name}>
            {marks ? <Marked before={previous!.name} after={version.name} /> : version.name}
          </Text>
        )}
        <Text style={styles.body}>
          {marks ? <Marked before={previous!.description} after={version.description} /> : version.description}
        </Text>
      </View>

      <View style={styles.toggle}>
        <Text style={styles.toggleText}>{t("postEditHistory.showChanges")}</Text>
        <CustomSwitch value={showChanges} onValueChange={setShowChanges} accessibilityLabel={t("postEditHistory.showChanges")} />
      </View>
    </View>
  );
};

/** The line itself, without the fetch. */
export const PostEditHistoryLineView: React.FC<{ editCount: number; versions: PostVersion[] }> = ({
  editCount,
  versions,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const lastEdit = versions[versions.length - 1]?.at;
  if (editCount < 1 || versions.length < 2) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.line, pressed && styles.linePressed]}
      >
        <Text style={styles.lineText}>{t("postEditHistory.edited", { count: editCount })}</Text>
        <View style={styles.lineRight}>
          {!!lastEdit && (
            <Text style={styles.lineMuted} numberOfLines={1}>
              {t("postEditHistory.lastEdit", { time: formatShortAgo(lastEdit) })}
            </Text>
          )}
          <Icon name="ChevronRight" size={16} color="rgba(255,255,255,0.6)" />
        </View>
      </Pressable>

      <GlassModal surface="theme" visible={open} onClose={() => setOpen(false)} presentation="bottom" scrollable maxHeight="80%">
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{t("postEditHistory.title")}</Text>
          <PostEditHistoryViewer versions={versions} />
        </View>
      </GlassModal>
    </>
  );
};

const PostEditHistoryLine: React.FC<{ tokenId: number | string }> = ({ tokenId }) => {
  const { data } = useQuery({
    queryKey: ["post-edit-history", String(tokenId)],
    queryFn: () => getPostEditHistory(tokenId),
    staleTime: 30_000,
  });
  if (!data) return null;
  return <PostEditHistoryLineView editCount={data.editCount} versions={data.versions} />;
};

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  linePressed: { backgroundColor: "rgba(255,255,255,0.1)" },
  lineText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  lineRight: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  lineMuted: { color: "rgba(255,255,255,0.6)", fontSize: 13, flexShrink: 1 },
  sheet: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 },
  sheetTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "600", textAlign: "center", marginBottom: 14 },
  steps: { gap: 6, paddingBottom: 2 },
  step: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  stepActive: { backgroundColor: "#FFFFFF", borderColor: "transparent" },
  stepText: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  stepTextActive: { color: "#000000" },
  version: {
    marginTop: 12,
    minHeight: 140,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  when: { color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 8 },
  name: { color: "#FFFFFF", fontSize: 15, fontWeight: "600", marginBottom: 6 },
  body: { color: "rgba(255,255,255,0.7)", fontSize: 14, lineHeight: 20 },
  // Marks keep the theme's own text colour so they read on light and dark alike.
  added: { backgroundColor: "rgba(16,185,129,0.25)", textDecorationLine: "underline", textDecorationColor: "#10B981" },
  removed: { textDecorationLine: "line-through", textDecorationColor: "#EF4444", opacity: 0.6 },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12 },
  toggleText: { color: "rgba(255,255,255,0.7)", fontSize: 14, flexShrink: 1 },
});

export default PostEditHistoryLine;
