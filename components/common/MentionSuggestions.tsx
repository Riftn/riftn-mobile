import { useTranslation as _useCopy } from 'react-i18next';
import React, { memo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  Platform,
} from "react-native";
import Avatar from "./Avatar";
import Icon from "../ui/Icon";
import { storageImageSource } from "../../libs/cdnImage";
import { formatCompactNumber } from "../../libs/numbers.util";
import { getAvatarUrl } from "../../libs";
import type { MentionUser } from "../../services/mention.service";
import { isAssistantAddress } from "../../libs/assistant";

interface MentionSuggestionsProps {
  visible: boolean;
  suggestions: MentionUser[];
  onSelect: (user: MentionUser) => void;
  loading?: boolean;
}

// Outside the component: an inline one is a new function on every letter,
// which makes the list throw its rows away and draw them again.
const rowKey = (item: MentionUser) => item.address || item.username;

const MentionSuggestions: React.FC<MentionSuggestionsProps> = ({
  visible,
  suggestions,
  onSelect,
  loading,
}) => {
  const { t: _copy } = _useCopy();
  const { t } = useTranslation();
  // Android can resize the sheet as soon as the focused input loses its
  // keyboard. Select on touch-down, before that resize can move this row out
  // from under the finger, while retaining onPress for accessibility and the
  // non-touch platforms.
  const selectedOnTouchStartRef = useRef<string | null>(null);
  const touchStartResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (touchStartResetRef.current) clearTimeout(touchStartResetRef.current);
  }, []);

  const selectOnTouchStart = useCallback((item: MentionUser) => {
    if (Platform.OS !== "android") return;

    const key = item.address || item.username;
    selectedOnTouchStartRef.current = key;
    if (touchStartResetRef.current) clearTimeout(touchStartResetRef.current);
    touchStartResetRef.current = setTimeout(() => {
      selectedOnTouchStartRef.current = null;
    }, 1500);
    onSelect(item);
  }, [onSelect]);

  const selectOnPress = useCallback((item: MentionUser) => {
    const key = item.address || item.username;
    if (selectedOnTouchStartRef.current === key) {
      selectedOnTouchStartRef.current = null;
      return;
    }
    onSelect(item);
  }, [onSelect]);

  // Headings only when the list mixes people with links.
  const mixed = suggestions.some((u) => (u.kind ?? "user") !== (suggestions[0]?.kind ?? "user"));

  const renderItem = useCallback(
    ({ item, index }: { item: MentionUser; index: number }) => {
      const kind = item.kind ?? "user";
      const groupStart = index === 0 || (suggestions[index - 1]?.kind ?? "user") !== kind;
      const heading = mixed && groupStart ? (
        <Text
          className="text-theme-neutrals-500 text-[11px] font-semibold uppercase px-4 pt-2.5 pb-0.5"
          style={{ letterSpacing: 0.6 }}
        >
          {kind === "community"
            ? t("mentionLinks.communities", { defaultValue: "Communities" })
            : kind === "page"
              ? t("mentionLinks.pages", { defaultValue: "Pages" })
              : t("mentionLinks.people", { defaultValue: "People" })}
        </Text>
      ) : null;

      if (kind !== "user") {
        return (
          <View>
            {heading}
            <Pressable
              onTouchStart={() => selectOnTouchStart(item)}
              onPress={() => selectOnPress(item)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              accessibilityRole="button"
              accessibilityLabel={t("mentionLinks.linkTo", { name: item.displayName || item.username, defaultValue: "Link {{name}}" })}
              className="flex-row items-center px-4 py-2.5"
            >
              <View
                className="items-center justify-center bg-white/10 overflow-hidden"
                style={{ width: 28, height: 28, borderRadius: 8 }}
              >
                {kind === "community" && item.avatarImageUrl ? (
                  <Avatar
                    uri={storageImageSource(item.avatarImageUrl, 28)?.uri}
                    size={28}
                    radius={8}
                    name={item.displayName || item.username}
                  />
                ) : (
                  <Icon name={kind === "community" ? "Users" : item.icon ?? "Link"} size={16} color="#E4E4E7" />
                )}
              </View>
              <View className="ml-2.5 flex-1">
                <Text className="text-white text-sm font-semibold" numberOfLines={1}>
                  {item.displayName || item.username}
                </Text>
                <Text className="text-theme-neutrals-400 text-xs" numberOfLines={1}>
                  {kind === "community"
                    ? `/${item.username}${typeof item.memberCount === "number" ? ` · ${t("linkCard.members", { compact: formatCompactNumber(item.memberCount) })}` : ""}`
                    : `riftn.com${item.username}`}
                </Text>
              </View>
            </Pressable>
          </View>
        );
      }

      const avatar = getAvatarUrl(item.avatarImageUrl || "");
      // Trust the flag when the API sends it, but fall back to the address so
      // the badge still shows against an older API build.
      const isAssistant = item.isAssistant || isAssistantAddress(item.address);
      return (
        <View>
        {heading}
        <Pressable
          onTouchStart={() => selectOnTouchStart(item)}
          onPress={() => selectOnPress(item)}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          accessibilityRole="button"
          accessibilityLabel={_copy("copy.6aad3f5a25b5", { defaultValue: "Mention @{{value1}}", value1: item.username })}
          className="flex-row items-center px-4 py-2.5"
        >
          <Avatar
            uri={avatar && avatar !== "default-avatar" ? avatar : undefined}
            size={28}
            name={item.displayName || item.username}
          />
          <View className="ml-2.5 flex-1">
            <View className="flex-row items-center">
              <Text
                className="text-white text-sm font-semibold"
                numberOfLines={1}
              >
                @{item.username}
              </Text>
              {/* The bot is a normal account, so without this it looks like a
                  user who happened to take the handle. */}
              {isAssistant && (
                <View className="ml-1.5 px-1.5 py-0.5 rounded-md bg-white/15 border border-white/15">
                  <Text className="text-white/75 text-[10px] font-semibold leading-none">
                    AI
                  </Text>
                </View>
              )}
            </View>
            {!!item.displayName &&
              item.displayName !== item.username && (
                <Text
                  className="text-theme-neutrals-400 text-xs"
                  numberOfLines={1}
                >
                  {item.displayName}
                </Text>
              )}
          </View>
          {item.isFollowing && (
            <Text className="text-theme-neutrals-500 text-xs">
              {t("follow.following")}
            </Text>
          )}
        </Pressable>
        </View>
      );
    },
    [selectOnPress, selectOnTouchStart, t, _copy, suggestions, mixed],
  );

  if (!visible) return null;

  return (
    <View
      className="bg-theme-neutrals-800/95 border border-white/10 rounded-xl overflow-hidden mb-1"
      // Taller once communities and pages can follow the people.
      style={{ maxHeight: mixed ? 260 : 200 }}
    >
      {loading && suggestions.length === 0 ? (
        <View className="py-4 items-center">
          <ActivityIndicator size="small" color="#9CA3AF" />
        </View>
      ) : (
        <FlatList
          data={suggestions}
          renderItem={renderItem}
          keyExtractor={rowKey}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

export default memo(MentionSuggestions);
