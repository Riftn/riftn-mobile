import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";
import { Gesture, GestureDetector, type NativeGesture } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import PullRefreshMark, { PULL_HOLD, PULL_HOLD_MAX_MS } from "../Feed/PullRefreshMark";
import { PULL_CANCEL_MS, PULL_RETURN_MS, pullForDrag, pullShouldRefresh, pullSpringProgress } from "../../libs/pill-pull-motion";
import { MOTION, SNAP_SPRING } from "../../theme/motion";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetGlassFill } from "../ui/SheetGlass";
import SheetBackdrop, { useSheetBackdrop } from "../ui/SheetBackdrop";
import { PinDrawerBlurSource } from "../ui/FrostedBackdrop";
import { SHEET_GLASS_BORDER, SHEET_GLASS_FILL } from "../../theme/sheetGlass";

/** Share of the screen the sheet sits lowered by when part open. */
const PART_OPEN_DROP = 0.2;
/** Pulled this share of the visible sheet closes on a slow release too. */
const CLOSE_SHARE = 0.25;
/** A flick closes once it has moved the sheet this far... */
const FLICK_MIN_PULL = 72;
/** ...and the finger is still moving down this fast (px/s) when it lets go. */
const FLICK_SPEED = 300;
/** A list scrolled this recently (ms) is still gliding from a fling. */
const SCROLL_SETTLE_MS = 140;
const SETTLE = { duration: 420, easing: Easing.bezier(0.32, 0.72, 0, 1) };

type DrawerRefresh = { refreshing: boolean; onRefresh: () => void };
type DrawerList = {
  gesture: NativeGesture;
  onScrollY: (y: number) => void;
  scrollEnabled: boolean;
};
const DrawerListContext = createContext<DrawerList | null>(null);
/** Fills the screen, from inside the drawer (the search field on focus). */
const DrawerExpandContext = createContext<(() => void) | null>(null);
export const usePageDrawerExpand = () => useContext(DrawerExpandContext);

/**
 * A whole page presented as a drawer, as phone web's bell drawer: a glass
 * sheet with no handle and no close button. It opens lowered by a fifth of
 * the screen, so the page above shows it is a drawer; dragging it up fills
 * the screen. Pulling down steps back to part open and then closes it (from
 * full, only once its list is at the top), as do a tap on the page above and
 * the system back. Host it in a route presented as a transparentModal with no
 * animation; the sheet does all the moving.
 *
 * With `refresh`, the drawer opens full and a pull at the top of the list
 * refreshes it instead of moving the sheet; the header still pulls the sheet
 * down to close it. The sheet's own pan draws that pull (the list lowers and
 * a refresh mark turns in the gap). It is not a RefreshControl: on Android
 * that wraps the scroll view in a SwipeRefreshLayout, the list's native
 * gesture then sat on the wrapper instead of the scroll view, and once the
 * sheet's pan took the finger the list stopped scrolling at all.
 *
 * The page's list must scroll in a `PageDrawerScrollView` (FlashList and
 * FlatList: `renderScrollComponent={PageDrawerScrollView}`), so the sheet
 * knows where the list is and can share the finger with it. Part open, the
 * list does not scroll: any vertical drag moves the sheet.
 */
export default function PageDrawer(props: PageDrawerProps) {
  return (
    <PinDrawerBlurSource>
      <Sheet {...props} />
    </PinDrawerBlurSource>
  );
}

type PageDrawerProps = {
  onClose: () => void;
  /** The top of the page (its header). */
  grab?: React.ReactNode;
  /** Opens full; a pull at the top of the list runs this instead of closing. */
  refresh?: DrawerRefresh;
  children: React.ReactNode;
};

/**
 * The drawer's scroll view. No bounce, so a pull at the top moves the sheet
 * and not the rows; outside a PageDrawer it is a plain ScrollView.
 */
export const PageDrawerScrollView = forwardRef<ScrollView, ScrollViewProps>(function PageDrawerScrollView(props, ref) {
  const list = useContext(DrawerListContext);
  const { onScroll } = props;
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    list?.onScrollY(e.nativeEvent.contentOffset.y);
    onScroll?.(e);
  }, [list, onScroll]);
  if (!list) return <ScrollView ref={ref} {...props} />;
  return (
    <GestureDetector gesture={list.gesture}>
      <ScrollView
        ref={ref}
        {...props}
        scrollEnabled={list.scrollEnabled && props.scrollEnabled !== false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        // No bounce and no RefreshControl: the drawer draws its own pull
        // (see Sheet), and the GestureDetector must sit on the scroll view
        // itself for the list to keep scrolling under the sheet's pan.
        bounces={false}
        overScrollMode="never"
        refreshControl={undefined}
      />
    </GestureDetector>
  );
});

function Sheet({ onClose, grab, refresh, children }: PageDrawerProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mid = Math.round(height * PART_OPEN_DROP);
  const translateY = useSharedValue(height);
  const backdrop = useSharedValue(0);
  // The page above stays sharp under a plain dim, not a live blur. On Android
  // the blur re-samples the whole page on every frame anything in the window
  // draws, so scrolling this list paid for a full-screen blur (about 1 in 3
  // frames late on a Galaxy S24+).
  const blur = useSheetBackdrop(false);

  // Where the list is, for the pull rules below.
  const scrollY = useSharedValue(0);
  const lastScrollAt = useSharedValue(0);
  const startedAtTop = useSharedValue(false);
  const openFull = !!refresh;
  const refreshable = useSharedValue(openFull);
  const expanded = useSharedValue(openFull);
  const base = useSharedValue(mid);
  const moving = useSharedValue(false);
  const closing = useSharedValue(false);
  // Height of the header, so a refreshable drawer can tell a pull on the
  // header (moves the sheet) from a pull on the list (refreshes it).
  const grabHeight = useSharedValue(0);
  const fromList = useSharedValue(false);
  // The list scrolls only once the sheet fills the screen.
  const [full, setFull] = useState(openFull);

  useEffect(() => {
    translateY.value = withTiming(openFull ? 0 : mid, { duration: MOTION.open, easing: Easing.out(Easing.cubic) });
    backdrop.value = withTiming(1, { duration: MOTION.backdropIn });
    // Mount-only: the sheet slides up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closing.value) return;
    closing.value = true;
    backdrop.value = withTiming(0, { duration: MOTION.backdropOut });
    translateY.value = withTiming(height, { duration: MOTION.close, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onClose)();
    });
  }, [backdrop, translateY, closing, height, onClose]);

  const expand = useCallback(() => {
    if (closing.value || expanded.value) return;
    expanded.value = true;
    translateY.value = withTiming(0, SETTLE);
    setFull(true);
  }, [closing, expanded, translateY]);

  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]));

  const onScrollY = useCallback((y: number) => {
    scrollY.value = y;
    lastScrollAt.value = Date.now();
  }, [scrollY, lastScrollAt]);
  const listGesture = useMemo(() => Gesture.Native(), []);
  const list = useMemo(() => ({ gesture: listGesture, onScrollY, scrollEnabled: full }), [listGesture, onScrollY, full]);

  // Pull to refresh, drawn by the sheet: how far the list is lowered.
  const refreshing = refresh?.refreshing ?? false;
  const onRefresh = refresh?.onRefresh;
  const pull = useSharedValue(0);
  // Armed when a drag starts on the list at its top; pulling once it moves down.
  const pullArmed = useSharedValue(false);
  const pulling = useSharedValue(false);
  // Lowered and waiting for the refresh to report back.
  const holding = useSharedValue(false);
  const busy = useSharedValue(refreshing);
  const [spinning, setSpinning] = useState(false);
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const settlePull = useCallback(() => {
    holding.value = false;
    pull.value = withTiming(0, { duration: PULL_RETURN_MS, easing: pullSpringProgress });
    setSpinning(false);
  }, [holding, pull]);
  const runRefresh = useCallback(() => {
    setSpinning(true);
    onRefresh?.();
    // A refresh that was skipped (one already running) never reports back.
    setTimeout(() => { if (!refreshingRef.current && holding.value) settlePull(); }, 700);
  }, [onRefresh, holding, settlePull]);
  useEffect(() => {
    busy.value = refreshing;
    if (refreshing || !holding.value) return;
    settlePull();
  }, [refreshing, busy, holding, settlePull]);
  // A refresh that never reports back must not hold the list down forever.
  useEffect(() => {
    if (!spinning) return;
    const timer = setTimeout(settlePull, PULL_HOLD_MAX_MS);
    return () => clearTimeout(timer);
  }, [spinning, settlePull]);

  // One pan over the whole sheet, sharing the finger with the list.
  // Part open, any vertical drag moves the sheet: up to fill the screen, down
  // to close. Full, the list scrolls, and a pull down only moves the sheet
  // when the list was at the top (and not still gliding from a fling) as the
  // finger went down, so a swipe that scrolls back up to the top stays a
  // scroll. On release it settles at the nearest sensible height: a short or
  // stopped pull springs back; from full a pull steps back to part open and a
  // long one closes; from part open a quarter of the sheet or a clear flick
  // down closes.
  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-16, 16])
    .simultaneousWithExternalGesture(listGesture)
    .onBegin((e) => {
      startedAtTop.value = scrollY.value <= 1 && Date.now() - lastScrollAt.value > SCROLL_SETTLE_MS;
      // Refreshable and full: the list owns pulls that start on it (they
      // refresh), the header owns the rest (they move the sheet).
      fromList.value = refreshable.value && expanded.value && e.y > insets.top + grabHeight.value;
      pullArmed.value = fromList.value && startedAtTop.value && !busy.value && !holding.value;
      pulling.value = false;
      base.value = expanded.value ? 0 : mid;
      moving.value = false;
    })
    .onUpdate((e) => {
      if (closing.value) return;
      if (fromList.value) {
        // A pull down from the top of the list lowers it to refresh; anything
        // else on the list is the list's own scroll.
        if (!pullArmed.value) return;
        if (!pulling.value) {
          if (scrollY.value > 1 || e.translationY < -4) { pullArmed.value = false; return; }
          if (e.translationY <= 0) return;
          pulling.value = true;
        }
        pull.value = pullForDrag(e.translationY);
        return;
      }
      if (expanded.value && refreshable.value) {
        // Full and refreshable, pulled by the header: down only.
        moving.value = true;
        translateY.value = Math.max(0, e.translationY);
      } else if (expanded.value) {
        // Full: only a pull down from the top of the list moves the sheet.
        if (!startedAtTop.value) return;
        if (!moving.value && (e.translationY <= 0 || scrollY.value > 1)) {
          if (scrollY.value > 1) startedAtTop.value = false;
          return;
        }
        moving.value = true;
        translateY.value = Math.max(0, e.translationY);
      } else {
        moving.value = true;
        let y = base.value + e.translationY;
        // Past full, it gives a little and stops.
        if (y < 0) y = y / 4;
        translateY.value = y;
      }
      const below = translateY.value - mid;
      backdrop.value = below > 0 ? 1 - Math.min(1, below / Math.max(1, height - mid)) : 1;
    })
    .onEnd((e) => {
      if (pulling.value) {
        pulling.value = false;
        pullArmed.value = false;
        if (pullShouldRefresh(pull.value, e.velocityY) && !busy.value) {
          holding.value = true;
          pull.value = withTiming(PULL_HOLD, { duration: PULL_RETURN_MS, easing: pullSpringProgress });
          runOnJS(runRefresh)();
        } else {
          pull.value = withTiming(0, { duration: PULL_CANCEL_MS, easing: pullSpringProgress });
        }
        return;
      }
      if (!moving.value || closing.value) return;
      const offset = translateY.value;
      const below = offset - mid;
      const speed = e.velocityY;
      if (below >= (height - mid) * CLOSE_SHARE || (below >= FLICK_MIN_PULL && speed >= FLICK_SPEED)) {
        closing.value = true;
        backdrop.value = withTiming(0, { duration: MOTION.backdropOut });
        // Carries on at the finger's speed rather than starting from rest.
        const rest = height - offset;
        const v = Math.max(speed, 1200);
        translateY.value = withTiming(height, { duration: Math.min(MOTION.close + 60, Math.max(140, (rest / v) * 1000)), easing: Easing.out(Easing.quad) }, (done) => {
          if (done) runOnJS(onClose)();
        });
        return;
      }
      let goFull: boolean;
      if (!expanded.value) {
        // Up far enough, or flicked up: fill the screen.
        const rose = mid - offset;
        goFull = rose >= 48 || (rose >= 16 && speed <= -FLICK_SPEED);
      } else {
        // From full: a clear pull or flick down steps back to part open.
        goFull = !(offset >= mid / 2 || (offset >= FLICK_MIN_PULL && speed >= FLICK_SPEED));
      }
      expanded.value = goFull;
      moving.value = false;
      translateY.value = withSpring(goFull ? 0 : mid, SNAP_SPRING);
      backdrop.value = withTiming(1, { duration: MOTION.backdropIn });
      runOnJS(setFull)(goFull);
    })
    .onFinalize(() => {
      if (pulling.value) {
        pulling.value = false;
        if (!holding.value) pull.value = withTiming(0, { duration: PULL_CANCEL_MS, easing: pullSpringProgress });
      }
      pullArmed.value = false;
      // Cancelled mid-drag (onEnd never ran): back to where it rested.
      if (!closing.value && moving.value) {
        translateY.value = withSpring(expanded.value ? 0 : mid, SNAP_SPRING);
        backdrop.value = withTiming(1, { duration: MOTION.backdropIn });
      }
      moving.value = false;
    }), [listGesture, startedAtTop, scrollY, lastScrollAt, base, expanded, moving, closing, translateY, backdrop, mid, height, onClose, refreshable, fromList, grabHeight, insets.top, pull, pullArmed, pulling, holding, busy, runRefresh]);

  const sheetStyle = useAnimatedStyle(() => {
    // How far toward full (0 part open, 1 full): the header clears the status
    // bar as it gets there. The rounded top stays, so it still reads as a drawer.
    const p = mid > 0 ? Math.max(0, Math.min(1, 1 - translateY.value / mid)) : 1;
    return {
      transform: [{ translateY: translateY.value }],
      paddingTop: insets.top * p,
    };
  });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const listPullStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));
  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <SheetBackdrop backdrop={blur} />
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.sheet, { height }, sheetStyle]}>
          {/* Liquid glass on every theme: the page behind blurred under the
              theme's wash, as phone web's bell drawer. */}
          <SheetGlassFill allThemes style={[StyleSheet.absoluteFill, styles.surface]} />
          <DrawerExpandContext.Provider value={expand}>
            <View style={styles.top} onLayout={(e) => { grabHeight.value = e.nativeEvent.layout.height; }}>
              {grab}
              {/* Shows the sheet can be dragged down. It sits in the header's
                  own top inset, so it adds no height. */}
              <View pointerEvents="none" style={styles.handle} accessible={false} />
            </View>
            <DrawerListContext.Provider value={list}>
              {/* Part open, the bottom fifth of the sheet sits below the
                  screen; keep the list's end above it. */}
              <View style={{ flex: 1, marginBottom: full ? 0 : mid, overflow: "hidden" }}>
                {refresh ? <PullRefreshMark pull={pull} holding={holding} spinning={spinning} /> : null}
                <Animated.View style={[{ flex: 1 }, refresh ? listPullStyle : null]}>{children}</Animated.View>
              </View>
            </DrawerListContext.Provider>
          </DrawerExpandContext.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  surface: {
    backgroundColor: SHEET_GLASS_FILL,
    borderTopWidth: 1,
    borderColor: SHEET_GLASS_BORDER,
  },
  // No room of its own above the header: the header's own 8pt top inset then
  // matches its 8pt sides.
  top: { paddingTop: 0 },
  handle: {
    position: "absolute",
    top: 3,
    left: "50%",
    marginLeft: -18,
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(161,161,170,0.45)",
  },
});
