import { createContext, useContext, useEffect } from "react";
import { useWindowDimensions } from "react-native";
import { useAppTheme } from "../../context/ThemeContext";
import type { IconName } from "../ui/Icon";

/** One control a player hands up to the card's tools menu. */
export type MediaTool = {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Drawn highlighted (a toggle that is on). */
  active?: boolean;
};

/**
 * Set by a feed card whose media runs edge to edge with its own chrome laid
 * over it (the system theme's home feed). The media components read it to
 * drop their card inset and corner radius, and to keep their own overlays
 * clear of that chrome: `topInset` is the band the author and buttons take
 * along the top, `bottomInset` the band they take along the bottom when they
 * sit there instead (the feed's first post, under the capsule).
 *
 * `setTools` is how a player folds its own buttons (speed, loop, sound,
 * subtitles, picture in picture, full screen) into the card's single tools
 * menu instead of drawing them over the picture.
 *
 * `setBarUp` is how a player says its bottom bar (the scrubber and times) is
 * on screen, so chrome sitting along the bottom can lift above it only then.
 */
export type FeedBleed = {
  topInset: number;
  /** Explicit top position for video buttons when the author is below media. */
  controlsTop?: number;
  bottomInset?: number;
  setTools?: (tools: MediaTool[] | null) => void;
  setBarUp?: (up: boolean) => void;
};

export const FeedBleedContext = createContext<FeedBleed | null>(null);

export const useFeedBleed = () => useContext(FeedBleedContext);

/** Hands `tools` to the card's tools menu while mounted; a no-op elsewhere. */
export function useMediaTools(tools: MediaTool[] | null) {
  const setTools = useFeedBleed()?.setTools;
  useEffect(() => {
    if (!setTools) return;
    setTools(tools);
  }, [setTools, tools]);
  useEffect(() => {
    if (!setTools) return;
    return () => setTools(null);
  }, [setTools]);
}

/**
 * System Light on a phone: the feed has no bentos. On white the card had no
 * edge you could see, so its inset only read as wasted space. Posts span the
 * screen like Minimal's: media edge to edge with square corners, text 12pt
 * from the edge, one hairline between posts. Matches the web's phone feed in
 * System Light (styles/system-light.css). Tablets keep their columns.
 */
export const LIGHT_FLAT_TEXT_INSET = 12;
export function useLightFlatFeed() {
  const { theme, isLight, skin } = useAppTheme();
  const { width } = useWindowDimensions();
  return theme === "system" && isLight && !skin && width < 560;
}
