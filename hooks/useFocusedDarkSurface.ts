import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAppTheme } from "../context/ThemeContext";

/**
 * useDarkSurface for a navigator screen: the hold lasts while the screen is
 * focused, not while it is mounted. Leaving it (Back, or opening a profile on
 * top) hands the app straight back to System Light as the screen starts to
 * go, so the page underneath never shows up dark and flips after the
 * animation. The screen keeps its own colours through `dark-surface`.
 */
export function useFocusedDarkSurface(): boolean {
  const { holdDarkSurface, isLight } = useAppTheme();
  useFocusEffect(useCallback(() => holdDarkSurface(), [holdDarkSurface]));
  return !isLight;
}
