import { useEffect, type RefObject } from "react";
import { Keyboard, Platform, type KeyboardEvent, type View } from "react-native";
import { Easing, useAnimatedKeyboard, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

/**
 * useKeyboardLift (hooks/useKeyboardLayout.ts) as a shared value, for a
 * bottom bar that has to ride up with the keys.
 *
 * As React state, every keyboard event re-rendered the whole screen and the
 * bar jumped to its new place in one frame while the keys were still
 * sliding. Here nothing re-renders: the value eases to the keyboard's height
 * on the UI thread, on the same curve and about the same time as the keys.
 *
 * Android follows the keys frame by frame (Reanimated reads the IME insets
 * while they animate). RN's keyboardDidShow only arrives as the keys finish
 * (~250ms after they start on a Galaxy S24+), so a bar driven by it sat
 * under the rising keys and then popped up. With edge-to-edge the inset is
 * measured from the screen's bottom, so the nav bar under the screen's own
 * bottom edge comes off.
 */
const ANDROID_KEYS = { duration: 220, easing: Easing.bezier(0.2, 0, 0, 1) };

function useAndroidLift(bottomInset: number, _anchor?: RefObject<View | null>): SharedValue<number> {
  const keyboard = useAnimatedKeyboard();
  return useDerivedValue(() => Math.max(0, keyboard.height.value - bottomInset), [bottomInset]);
}

export const useKeyboardLiftValue = Platform.OS === "android" ? useAndroidLift : useEventLift;

/**
 * `anchor` (iPhone): the view whose bottom edge the bar sits on. With it the
 * lift is measured, the anchor's real bottom against the top of the keys,
 * instead of worked out from the safe area. The post composer needs that: it
 * is a native modal sheet that runs to the very bottom of the screen, below
 * where the safe area ends, so "keyboard minus the home-indicator band" left
 * the Post row that far under the keys.
 */
function useEventLift(bottomInset: number, anchor?: RefObject<View | null>): SharedValue<number> {
  const lift = useSharedValue(0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const rise = (target: number, duration?: number) => {
      lift.value = ios
        ? withTiming(target, { duration: duration || 250, easing: Easing.bezier(0.17, 0.59, 0.4, 0.77) })
        : withTiming(target, ANDROID_KEYS);
    };
    const onShow = (e: KeyboardEvent) => {
      const h = e.endCoordinates?.height ?? 0;
      const fallback = ios ? Math.max(h - bottomInset, 0) : h;
      const keysTop = e.endCoordinates?.screenY;
      const view = ios ? anchor?.current : null;
      if (!view || typeof keysTop !== "number") {
        rise(fallback, e.duration);
        return;
      }
      view.measureInWindow((_x, y, _w, height) => {
        const measured = Number.isFinite(y) && height > 0 ? Math.max(y + height - keysTop, 0) : fallback;
        rise(measured, e.duration);
      });
    };
    const onHide = (e?: KeyboardEvent) => rise(0, e?.duration);
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", onShow);
    // iPhone: the keys can start rising before this screen is listening (a
    // field that takes the cursor as the page opens), and change height
    // without a new "will show". Where they ended up always arrives here.
    const settled = ios ? Keyboard.addListener("keyboardDidShow", onShow) : null;
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", onHide);
    if (Keyboard.isVisible()) {
      const m = Keyboard.metrics();
      if (m) lift.value = ios ? Math.max(m.height - bottomInset, 0) : m.height;
    }
    return () => { show.remove(); settled?.remove(); hide.remove(); };
  }, [bottomInset, lift, anchor]);
  return lift;
}
