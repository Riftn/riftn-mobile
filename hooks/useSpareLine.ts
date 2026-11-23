import { useCallback, useState } from "react";
import { Platform, type NativeSyntheticEvent, type TextInputContentSizeChangeEventData } from "react-native";

/** Room kept under the last line (dp): a bit more than one line of body text. */
const SPARE_LINE = 28;
const ACTIVE = Platform.OS === "android";

/**
 * Keeps one empty line of room under a growing multiline TextInput (Android).
 *
 * The box grows a frame after its text does, and in that frame a new line
 * does not fit: the EditText scrolls its own text up a line, then drops it
 * back once it has grown, so the writing jumps on every Enter (and a little
 * on every letter). With a spare line below, the new line always fits.
 *
 * Spread `style` after the input's own style and pass `onContentSizeChange`.
 * `floor` is the box's own minimum height, which this never goes under, and
 * `ceiling` its maximum (Yoga lets a minHeight beat a maxHeight).
 */
export function useSpareLine(floor = 0, ceiling = Number.POSITIVE_INFINITY) {
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const onContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      if (!ACTIVE) return;
      const height = event.nativeEvent.contentSize?.height;
      if (!height) return;
      // Sized from the text's own height. A report that already equals the
      // room given (a box measuring itself) changes nothing, so it can't creep.
      setMinHeight((current) => (current === height ? current : Math.min(ceiling, Math.max(floor, Math.ceil(height + SPARE_LINE)))));
    },
    [floor, ceiling],
  );
  return { style: ACTIVE && minHeight ? { minHeight } : undefined, onContentSizeChange };
}
