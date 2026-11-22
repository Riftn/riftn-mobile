/**
 * Links as 🔗
 * ===========
 * The web shows a link inside a post, a comment or a chat line as a tappable
 * 🔗 (TranslatableText `renderTextWithLinks`), with the link's preview card
 * underneath saying where it goes. The app printed the whole address instead,
 * so the same post read differently on the two. This is the app's copy of that
 * rule, for every surface the web uses it on.
 *
 * DMs keep the written address on both (web `renderChatTextWithLinks`), so they
 * do not use this.
 *
 * A link written `<riftn.com>` is the author asking for the address as text
 * (web lib/link-display): it stays tappable, shown short, without brackets.
 */
import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { tokenizeChatText } from "../../libs/chat-links";
import { openInApp } from "../../libs/links.utils";

export const LINK_EMOJI = "🔗";

/** Web's abbreviateUrl: no protocol or www, long ones cut in the middle. */
export function abbreviateUrl(url: string, max = 36): string {
  const bare = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  if (bare.length <= max) return bare;
  const head = Math.ceil((max - 1) * 0.6);
  return `${bare.slice(0, head)}…${bare.slice(bare.length - (max - 1 - head))}`;
}

interface LinkEmojiOptions {
  /** A link swallows the touch, so a hold on it still opens the message menu. */
  onLongPress?: () => void;
  /** Defaults to opening in the app (Riftn links open in place). */
  onOpen?: (url: string) => void;
  keyPrefix?: string;
  /** Style for a `<link>` written out as text. */
  textLinkStyle?: StyleProp<TextStyle>;
}

/**
 * The text with each link swapped for a tappable 🔗. Plain runs come back as
 * strings, so callers can still pick out mentions or emoji in them.
 */
export function renderLinkEmojis(text: string | null | undefined, options: LinkEmojiOptions = {}): React.ReactNode[] {
  const { onLongPress, onOpen, keyPrefix = "link", textLinkStyle } = options;
  const open = onOpen ?? ((url: string) => openInApp(url));
  return tokenizeChatText(text).map((token, index) => {
    if (token.type === "text") return token.value;
    return (
      <Text
        key={`${keyPrefix}-${index}`}
        accessibilityRole="link"
        accessibilityLabel={token.url}
        onPress={() => open(token.url)}
        onLongPress={onLongPress}
        suppressHighlighting
        style={token.asText ? [{ textDecorationLine: "underline" }, textLinkStyle] : undefined}
      >
        {token.asText ? abbreviateUrl(token.value) : LINK_EMOJI}
      </Text>
    );
  });
}
