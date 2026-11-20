/**
 * Co-authors on a post's header: the first co-author's face tucked on the
 * creator's avatar, and "& Name" (+N) after the creator's name.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import Avatar from "./Avatar";
import { getAvatarUrl } from "../../libs/misc";
import { useAppTheme } from "../../context/ThemeContext";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import { coAuthorName, type CoAuthorUser } from "../../libs/coAuthors";

export function coAuthorAvatar(user: CoAuthorUser, size: number): string | undefined {
  const url = user.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl, size) : undefined;
  return url && url !== "default-avatar" ? url : undefined;
}

export function CoAuthorFace({ user, size }: { user: CoAuthorUser; size: number }) {
  return <Avatar uri={coAuthorAvatar(user, size)} size={size} name={coAuthorName(user)} />;
}

/** Sits in the corner of a `size`-point avatar that has the header's 8pt right margin. */
export function CoAuthorAvatarBadge({ users, size }: { users: CoAuthorUser[]; size: number }) {
  const { isLight } = useAppTheme();
  if (!users.length) return null;
  const face = Math.round(size * 0.55);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        // The avatar carries an 8pt right margin; this overhangs its edge by 4.
        right: 4,
        bottom: -4,
        padding: 1.5,
        borderRadius: Math.round(face * 0.2) + 2,
        // hsla() so the theme colour passes leave the outline alone.
        backgroundColor: isLight ? "hsla(0,0%,100%,1)" : "hsla(0,0%,0%,1)",
      }}
    >
      <CoAuthorFace user={users[0]} size={face} />
    </View>
  );
}

export function CoAuthorNames({ users, fontSize, lineHeight }: { users: CoAuthorUser[]; fontSize: number; lineHeight: number }) {
  const { showUserProfile } = useUserProfileSheet();
  if (!users.length) return null;
  const [first, ...rest] = users;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0, marginLeft: 4, height: lineHeight }}>
      <Text style={{ color: "#A6A9AC", fontSize: 14, lineHeight, includeFontPadding: false, marginRight: 4 }}>&amp;</Text>
      <Pressable
        onPress={() => showUserProfile(first.username || first.address)}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }}
        style={{ flexShrink: 1, minWidth: 0 }}
        accessibilityRole="link"
      >
        <Text
          className="font-semibold"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: "#F9FBFF", fontSize, lineHeight, includeFontPadding: false }}
        >
          {coAuthorName(first)}
        </Text>
      </Pressable>
      {rest.length > 0 && (
        <Text style={{ color: "#A6A9AC", fontSize: 14, lineHeight, includeFontPadding: false, marginLeft: 4 }}>+{rest.length}</Text>
      )}
    </View>
  );
}
