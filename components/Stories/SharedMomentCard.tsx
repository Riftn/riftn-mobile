import React, { type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Avatar from "../common/Avatar";
import Icon from "../ui/Icon";
import type { PostMomentDetails } from "./post-moment";

export const SHARED_MOMENT_CARD_FRACTION = 0.78;

export function SharedMomentCard({ side, children, details, expanded, onToggle, onHold, onRelease, pending, fallback }: {
  side: number;
  children?: ReactNode;
  details?: PostMomentDetails | null;
  expanded: boolean;
  onToggle: () => void;
  onHold?: () => void;
  onRelease?: () => void;
  pending?: boolean;
  fallback?: PostMomentDetails;
}) {
  const { t } = useTranslation();
  const name = details?.authorName || fallback?.authorName;
  return (
    <View style={[styles.card, { width: side, height: side, transform: [{ translateY: -side / 2 }] }]} pointerEvents="box-none">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">{children}</View>
      <Pressable style={styles.toggle} onPress={onToggle} onLongPress={onHold} onPressOut={onRelease}
        delayLongPress={180} accessibilityRole="button" accessibilityHint={name} accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? t("stories.hidePostDetails", { defaultValue: "Hide post details" })
          : t("stories.showPostDetails", { defaultValue: "Show post details" })}>
        <View style={styles.credit} pointerEvents="none">
          <Avatar uri={details?.avatarUrl || fallback?.avatarUrl} size={28} radius={14} name={name} />
          <Text style={styles.name} numberOfLines={1}>{name || t("stories.fromAPost", { defaultValue: "From a post" })}</Text>
          <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={16} color="#fff" />
        </View>
      </Pressable>
      {expanded ? (
        <ScrollView style={styles.details} contentContainerStyle={styles.detailsContent} accessibilityLiveRegion="polite">
          {details?.title ? <Text style={[styles.text, styles.title]}>{details.title}</Text> : null}
          {details?.description ? <Text style={styles.text}>{details.description}</Text> : null}
          {!details?.title && !details?.description ? (
            <Text style={styles.text}>{pending ? t("common.loading", { defaultValue: "Loading" })
              : details ? t("stories.noPostDetails", { defaultValue: "No title or description" })
              : t("stories.postDetailsUnavailable", { defaultValue: "Post details unavailable" })}</Text>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute", alignSelf: "center", top: "50%",
    borderRadius: 16, overflow: "hidden", backgroundColor: "#161616",
  },
  toggle: { ...StyleSheet.absoluteFillObject, borderWidth: 1, borderColor: "rgba(255,255,255,0.23)", borderRadius: 16 },
  credit: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "rgba(0,0,0,0.8)" },
  name: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "600" },
  details: { position: "absolute", bottom: 0, left: 0, right: 0, maxHeight: "70%", backgroundColor: "rgba(0,0,0,0.88)" },
  detailsContent: { gap: 4, paddingHorizontal: 12, paddingVertical: 10 },
  text: { color: "#fff", fontSize: 13 },
  title: { fontWeight: "700" },
});
