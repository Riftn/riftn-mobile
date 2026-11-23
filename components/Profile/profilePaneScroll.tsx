import React, { createContext, forwardRef, useContext, useEffect, useMemo, useRef } from "react";
import { FlatList, ScrollView } from "react-native";
import Animated from "react-native-reanimated";

/**
 * Keeps a profile steady when you switch tabs.
 *
 * Every profile tab is its own list with its own copy of the header, so a
 * switch used to show the new tab wherever its list happened to be: at the
 * top (header back in view) or where it was last left. The page jumped on
 * every tap, and again when a tab's loading list was swapped for its posts.
 *
 * The tabs component decides where the new tab should sit (same height while
 * the header is in view, just under the pinned bar once it is pinned) and
 * hands it down here. Every scrolling list inside a tab takes that spot as
 * its `contentOffset`, so the list is placed in the same native update that
 * shows it: no frame at the old spot, no scroll after the fact. Lists are
 * also kept at least tall enough for the tab bar to reach its pinned spot,
 * so a short or still-loading tab can sit there too.
 */
export type ProfilePaneScroll = {
  /** Where this tab's list is now (offsets kept on the UI thread). */
  getY: () => number;
  /** Where the tab goes when it is brought back, and how many times that happened. */
  restoreY: number;
  restoreSeq: number;
  /** Least height of a list's content. 0 = no floor. */
  minHeight: number;
};

export const ProfilePaneScrollContext = createContext<ProfilePaneScroll | null>(null);

export { profileTabTarget } from "./profileTabTarget";

/** Lets the simulator check see each switch (scripts/ios-nav/tour.ts). */
export function noteProfileTabSwitch(info: Record<string, unknown>): void {
  (globalThis as { __profileTabSwitch?: (info: Record<string, unknown>) => void }).__profileTabSwitch?.(info);
}

/** Holds one value object per tab, rebuilt only when that tab's numbers change. */
export function useProfilePaneScrolls(
  getOffset: (key: string) => number,
  restores: Record<string, { y: number; seq: number }>,
  minHeight: number,
) {
  const cache = useRef(new Map<string, ProfilePaneScroll>());
  const getOffsetRef = useRef(getOffset);
  getOffsetRef.current = getOffset;
  return (key: string): ProfilePaneScroll => {
    const restore = restores[key];
    const restoreY = restore?.y ?? 0;
    const restoreSeq = restore?.seq ?? 0;
    const held = cache.current.get(key);
    if (held && held.restoreY === restoreY && held.restoreSeq === restoreSeq && held.minHeight === minHeight) return held;
    const next = { getY: () => getOffsetRef.current(key), restoreY, restoreSeq, minHeight };
    cache.current.set(key, next);
    return next;
  };
}

/**
 * The scroll props a list inside a profile tab adds. Outside a profile tab it
 * adds nothing.
 *
 * A list starts where its tab is now (a loading list swapped for the posts
 * keeps the spot), and is moved only when its tab is brought back by a
 * switch. The small fraction makes each of those spots a new value, so the
 * native list applies it even when the number itself repeats.
 */
export function useProfilePaneScroll(): { contentOffset?: { x: number; y: number }; minHeightStyle?: { minHeight: number } } {
  const pane = useContext(ProfilePaneScrollContext);
  const mounted = useRef<{ seq: number; y: number } | null>(null);
  if (pane && !mounted.current) mounted.current = { seq: pane.restoreSeq, y: pane.getY() };
  const seq = pane?.restoreSeq ?? 0;
  const y = !pane || !mounted.current
    ? -1
    : (seq === mounted.current.seq ? mounted.current.y : pane.restoreY) + ((seq % 9) + 1) / 1000;
  const contentOffset = useMemo(() => (y >= 0 ? { x: 0, y } : undefined), [y]);
  // The simulator check listens here (scripts/ios-nav/tour.ts); nothing else does.
  useEffect(() => {
    if (y >= 0) (globalThis as { __profilePaneOffset?: (y: number, seq: number) => void }).__profilePaneOffset?.(y, seq);
  }, [y, seq]);
  const minHeight = pane?.minHeight ?? 0;
  const minHeightStyle = useMemo(() => (minHeight > 0 ? { minHeight } : undefined), [minHeight]);
  return { contentOffset, minHeightStyle };
}

function withPaneScroll<P extends { contentOffset?: unknown; contentContainerStyle?: unknown }>(List: React.ComponentType<P>, name: string) {
  const Wrapped = forwardRef<unknown, P>((props, ref) => {
    const { contentOffset, minHeightStyle } = useProfilePaneScroll();
    const style = useMemo(
      () => (minHeightStyle ? [props.contentContainerStyle, minHeightStyle] : props.contentContainerStyle),
      [props.contentContainerStyle, minHeightStyle],
    );
    const extra = contentOffset && props.contentOffset === undefined ? { contentOffset } : null;
    return <List {...(props as P)} {...extra} contentContainerStyle={style} ref={ref} />;
  });
  Wrapped.displayName = name;
  return Wrapped as unknown as React.ComponentType<P & { ref?: React.Ref<any> }>;
}

/** Drop-in lists for anything that scrolls inside a profile tab. */
export const PaneAnimatedFlatList = withPaneScroll(Animated.FlatList as unknown as React.ComponentType<any>, "PaneAnimatedFlatList");
export const PaneFlatList = withPaneScroll(FlatList as unknown as React.ComponentType<any>, "PaneFlatList");
export const PaneAnimatedScrollView = withPaneScroll(Animated.ScrollView as unknown as React.ComponentType<any>, "PaneAnimatedScrollView");
export const PaneScrollView = withPaneScroll(ScrollView as unknown as React.ComponentType<any>, "PaneScrollView");
