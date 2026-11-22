import React from "react";
import { Text } from "react-native";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import { chatMentionSpans } from "../../libs/community-mentions";

export default function ProfileBio({ text }: { text: string }) {
  const { showUserProfile } = useUserProfileSheet();
  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const { start, end, username, broadcast } of chatMentionSpans(text)) {
    if (broadcast) continue;
    parts.push(text.slice(offset, start));
    parts.push(
      <Text
        key={start}
        accessibilityRole="link"
        style={{ textDecorationLine: "underline" }}
        onPress={event => { event.stopPropagation(); showUserProfile(username); }}
      >
        {text.slice(start, end)}
      </Text>
    );
    offset = end;
  }
  return <Text className="text-white/90" style={{ fontSize: 16, lineHeight: 24 }}>{parts}{text.slice(offset)}</Text>;
}
