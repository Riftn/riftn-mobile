/**
 * The post composer's text box.
 *
 * The composer screen is large, and a controlled TextInput waits for the whole
 * screen to re-render before it confirms each keystroke. While that render was
 * still running, the box could be handed an older value back, which moved the
 * caret and occasionally dropped a letter. This box keeps its own copy of the
 * text, so typing paints at once, and passes each change up as a transition the
 * screen can catch up with.
 *
 * A `value` from the screen that is not one of the box's own changes (a mention
 * filled in, an emoji, a draft loaded, the box cleared after posting) is taken
 * as is.
 *
 * On Android the box keeps one empty line of room below the text. It grows a
 * frame after the text does, and in that frame a new line did not fit: the
 * box scrolled its own text up a line, then dropped it back once it had grown,
 * so the writing jumped on every Enter (and a little on every letter).
 */
import React, { memo, startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputProps,
} from "react-native";

type Props = Omit<TextInputProps, "value" | "onChangeText" | "defaultValue"> & {
  value: string;
  onChangeText: (text: string) => void;
  ref?: React.Ref<TextInput>;
};

/** Room kept under the last line (dp): a bit more than one line of body text. */
const SPARE_LINE = 28;
const KEEP_SPARE_LINE = Platform.OS === "android";

const ComposerBodyInput = memo(function ComposerBodyInput({ value, onChangeText, onContentSizeChange, style, ...rest }: Props) {
  const [text, setText] = useState(value);
  // Changes sent up that the screen has not echoed back yet, oldest first.
  const pending = useRef<string[]>([]);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const at = pending.current.indexOf(value);
    if (at !== -1) {
      // Our own change coming back (or an older one the screen skipped past).
      pending.current = pending.current.slice(at + 1);
      return;
    }
    pending.current = [];
    setText(value);
  }, [value]);

  const handleChange = useCallback(
    (next: string) => {
      setText(next);
      pending.current.push(next);
      if (pending.current.length > 50) pending.current.shift();
      startTransition(() => onChangeText(next));
    },
    [onChangeText],
  );

  const handleContentSize = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      onContentSizeChange?.(event);
      if (!KEEP_SPARE_LINE) return;
      const height = event.nativeEvent.contentSize?.height;
      if (!height) return;
      // Sized from the text's own height. A report that already equals the
      // room given (a box measuring itself) changes nothing, so it can't creep.
      setMinHeight((current) => (current === height ? current : Math.ceil(height + SPARE_LINE)));
    },
    [onContentSizeChange],
  );

  return (
    <TextInput
      {...rest}
      style={KEEP_SPARE_LINE && minHeight ? [style, { minHeight }] : style}
      value={text}
      onChangeText={handleChange}
      onContentSizeChange={handleContentSize}
    />
  );
});

export default ComposerBodyInput;
