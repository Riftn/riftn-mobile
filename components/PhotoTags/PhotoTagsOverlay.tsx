import React, { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import type { PhotoTag } from "../../services/photo-tags.service";

/**
 * People tagged on a post's photos. A small person button sits on the
 * photo's corner; tapping it lays the names over the photo, and tapping a name
 * opens that profile.
 */
const PhotoTagsOverlay: React.FC<{ tags: PhotoTag[]; onPressUser: (username: string) => void }> = ({ tags, onPressUser }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const names = Array.from(new Set(tags.map((tag) => tag.username).filter(Boolean)));
  if (!names.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 10, right: 10, bottom: 10, flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={open ? t("photoTags.hideTags") : t("photoTags.showTags")}
      >
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.6)" }}>
          <Icon name="UserRound" size={16} color="rgba(255,255,255,1)" />
        </View>
      </Pressable>
      {open && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, alignItems: "center" }}>
          {names.map((name) => (
            <Pressable key={name} onPress={() => onPressUser(name)} accessibilityRole="link">
              <View style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(0,0,0,0.7)" }}>
                <Text style={{ color: "rgba(255,255,255,1)", fontSize: 13, fontWeight: "600" }}>@{name}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

export default React.memo(PhotoTagsOverlay);
