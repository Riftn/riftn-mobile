import React, { memo, useCallback } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { tokenizeChatText } from "../../libs/chat-links";
import { openExternalLink } from "../../libs/links.utils";
import { expandEmojiTokens } from "./EmojiText";

interface LinkedTextProps {
  /** The message text. */
  text?: string | null;
  /** Classes for the paragraph — the caller keeps control of size and colour. */
  className?: string;
  /**
   * Forwarded to every link run. A link swallows the touch that would otherwise
   * reach the bubble underneath it, so without this a long press that happens
   * to land on a link silently does nothing instead of opening the message menu.
   */
  onLongPress?: () => void;
  /** Point size of the paragraph, so image emoji match the text around them. */
  fontSize?: number;
  /** Inline overrides, e.g. the reader's chat text size. */
  style?: StyleProp<TextStyle>;
}

/**
 * A message paragraph with its links made tappable.
 *
 * The link text stays on screen rather than collapsing to an icon: in a
 * conversation the URL is what the sender wrote, and hiding it leaves the
 * reader nothing to judge before opening it and nothing to copy. There is no
 * hover on a phone, so a tooltip is not a substitute.
 */
const LinkedText: React.FC<LinkedTextProps> = ({ text, className, onLongPress, fontSize, style }) => {
  const handlePress = useCallback((url: string) => {
    void openExternalLink(url);
  }, []);

  const tokens = tokenizeChatText(text);

  const parts: React.ReactNode[] = tokens.map((token, index) =>
    token.type === "link" ? (
      <Text
        key={`link-${index}`}
        className="underline"
        onPress={() => handlePress(token.url)}
        onLongPress={onLongPress}
        suppressHighlighting
      >
        {token.value}
      </Text>
    ) : (
      token.value
    ),
  );

  // Emoji only in the plain runs, so a colon inside a URL is never read as
  // one; one pass over the whole line so a **bold** run can hold a link.
  return (
    <Text className={className} style={style}>
      {expandEmojiTokens(parts, { fontSize, keyPrefix: "em" })}
    </Text>
  );
};

export default memo(LinkedText);
