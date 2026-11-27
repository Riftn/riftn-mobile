import React, { useState, type RefObject } from "react";
import { Pressable, StyleSheet, type TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { useKeyboardSwap } from "../../hooks/useKeyboardSwap";
import Icon from "../ui/Icon";
import WhenOpened from "../ui/WhenOpened";
import EmojiSheet from "../Upload/EmojiSheet";

interface Props {
  inputRef: RefObject<TextInput | null>;
  onSelect: (emoji: string) => void;
}

export default function LiveChatEmojiButton({ inputRef, onSelect }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const keyboard = useKeyboardSwap(inputRef);

  return (
    <>
      <Pressable
        {...keyboard.pressProps(() => keyboard.swapTo(() => setOpen(true)))}
        accessibilityRole="button"
        accessibilityLabel={t("comments.addEmoji")}
        accessibilityState={{ expanded: open }}
        hitSlop={6}
        style={styles.button}
      >
        <Icon name="Smile" size={19} color="#fff" />
      </Pressable>
      <WhenOpened open={open}>
        {() => (
          <EmojiSheet
            visible={open}
            onClose={() => {
              setOpen(false);
              keyboard.restore();
            }}
            onSelect={onSelect}
            keepOpen
          />
        )}
      </WhenOpened>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 27,
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});
