import { useCallback, useContext, useEffect, useRef } from "react";
import { Dimensions, Keyboard, Platform, StatusBar, type View } from "react-native";
import { useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { initialSafeAreaMetrics } from "../libs/initialSafeAreaMetrics";
import { keyboardTopFromEvent } from "../libs/keyboard-composer";
import { useKeyboardLiftValue } from "./useKeyboardLiftValue";
import { selfLiftingComposers } from "./useComposerKeyboard";

/**
 * Last correction between the keys' own height and where the composer really
 * had to go, kept for the session so the next open is right from frame one.
 */
let savedFix = 0;
const MAX_FIX = 96;

/**
 * A bottom composer that rides the keyboard frame by frame, on the UI thread.
 *
 * useComposerKeyboard measures the box and sets React state once the keys have
 * finished opening (keyboardDidShow on Android), so the box and anything under
 * it jumped a whole keyboard in one frame after the keys were already up.
 * Here the lift follows the keys as they move (useKeyboardLiftValue), and the
 * composer is still measured once the keys settle: any gap or overlap left
 * (a nav bar the insets got wrong, a screen that ends somewhere else) is eased
 * out and remembered for the next open.
 *
 * Put `ref` on the composer and drive its translateY with `-lift.value`.
 */
export function useKeyboardRide(): { ref: React.RefObject<View | null>; lift: SharedValue<number> } {
  const ref = useRef<View>(null);
  const insets = useContext(SafeAreaInsetsContext);
  // Same floor as useComposerKeyboard: the provider's inset can read 0.
  const navBar = Math.max(insets?.bottom ?? 0, initialSafeAreaMetrics.insets.bottom ?? 0);
  const raw = useKeyboardLiftValue(Platform.OS === "android" ? navBar : insets?.bottom ?? 0);
  const fix = useSharedValue(savedFix);
  const lift = useDerivedValue(() => {
    const keys = raw.value;
    if (keys <= 0) return 0;
    // Bring the correction in with the keys so a closed keyboard is exactly 0.
    return Math.max(0, keys + fix.value * Math.min(1, keys / 160));
  });

  useEffect(() => {
    selfLiftingComposers.add(ref);
    return () => { selfLiftingComposers.delete(ref); };
  }, []);

  const nav = useRef(navBar);
  nav.current = navBar;
  const statusBar = useRef(0);
  statusBar.current = (StatusBar?.currentHeight ?? 0) || (insets?.top ?? 0) || (initialSafeAreaMetrics.insets.top ?? 0);

  const check = useCallback(() => {
    const metrics = typeof Keyboard.metrics === "function" ? Keyboard.metrics() : undefined;
    const node = ref.current;
    if (!metrics || !node?.measureInWindow) return;
    const top = keyboardTopFromEvent(metrics, Platform.OS, Dimensions.get("screen")?.height ?? 0, nav.current);
    node.measureInWindow((_x, y, _w, h) => {
      if (!h || !Keyboard.isVisible()) return;
      // Android's window coordinates start under the status bar; the keys' are screen coordinates.
      const windowTop = Platform.OS === "android" ? statusBar.current : 0;
      const overlap = y + windowTop + h - top;
      if (Math.abs(overlap) < 1) return;
      const next = Math.max(-MAX_FIX, Math.min(MAX_FIX, fix.value + overlap));
      savedFix = next;
      fix.value = withTiming(next, { duration: 140 });
    });
  }, [fix]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Android sends keyboardDidShow as the keys START to rise, not when they
    // land. Measuring 80ms later caught the composer mid-ride, read it as
    // "still under the keys" and pushed it the whole correction too high;
    // the next check pulled it back down. That overshoot and snap back was
    // the jitter on every tap into Public Chat. Measure only once the ride
    // has stopped moving, and once more for keyboards that resize late.
    const settle = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
      let last = Number.NaN;
      let polls = 0;
      const poll = () => {
        const now = lift.value;
        if (now > 0 && Math.abs(now - last) < 0.5) {
          check();
          timers.push(setTimeout(check, 400));
          return;
        }
        last = now;
        if (++polls < 24) timers.push(setTimeout(poll, 50));
      };
      timers.push(setTimeout(poll, 50));
    };
    const show = Keyboard.addListener("keyboardDidShow", settle);
    return () => { show.remove(); timers.forEach(clearTimeout); };
  }, [check, lift]);

  return { ref, lift };
}
