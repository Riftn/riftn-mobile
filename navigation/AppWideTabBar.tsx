import React, { useEffect, useRef, useState } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import { navigationRef } from "../App";
import { ScreenNames } from "./ScreenNames";
import StandaloneTabBar from "./StandaloneTabBar";
import { useOwnTabBarCount } from "../libs/tab-bar-presence";
import { usePerfProbe } from "../libs/perfTrace";

/**
 * Pages where the bottom bar has no place: the tabs (they draw the real one),
 * full-screen media and players, cameras and composers, chats with their own
 * message box, and sign-in. Everywhere else, the bar stays.
 */
const NO_BAR = new Set<string>([
  // The stacks themselves: the current route is one of these for a frame
  // while a stack mounts (after a log-in or log-out), before its first page
  // is set, and a bar drawn then flashed over Home.
  ScreenNames.App,
  ScreenNames.Auth,
  ScreenNames.Maintenance,
  ScreenNames.Root,
  ScreenNames.Home,
  ScreenNames.DM,
  ScreenNames.UploadTab,
  ScreenNames.AIChat,
  ScreenNames.Explore,
  ScreenNames.ProfileTab,
  ScreenNames.SignIn,
  ScreenNames.SignInTv,
  ScreenNames.Upload,
  ScreenNames.UploadQueue,
  ScreenNames.EditProfile,
  ScreenNames.MediaEditor,
  ScreenNames.VideoRemix,
  ScreenNames.Creator,
  ScreenNames.CreatorStudio,
  ScreenNames.CreatorFlow,
  ScreenNames.CreatorFlowView,
  ScreenNames.Maboroshi,
  ScreenNames.CreatorRemake,
  ScreenNames.ImageViewer,
  ScreenNames.FullscreenVideo,
  ScreenNames.ShortsViewer,
  ScreenNames.VideoPlayer,
  ScreenNames.LiveViewer,
  ScreenNames.LiveProducer,
  ScreenNames.LiveStudio,
  ScreenNames.Chat,
  ScreenNames.LiveChat,
  ScreenNames.StageRecording,
  ScreenNames.ArcadeGame,
  ScreenNames.ArcadeChessOnline,
  ScreenNames.MiniApp,
  ScreenNames.MiniAppDev,
  ScreenNames.Cinema,
  ScreenNames.TV,
  ScreenNames.Builder,
  ScreenNames.BuilderPreview,
  ScreenNames.WorkPost,
  ScreenNames.WorkEdit,
  ScreenNames.LaunchpadCreate,
]);

function currentRouteName(): string | undefined {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
}

/**
 * The bottom bar over pages pushed on top of the tabs, so it doesn't vanish
 * the moment you leave Home. It stands down where a page draws its own copy,
 * on the pages above, and while the keyboard is up.
 */
export default function AppWideTabBar() {
  usePerfProbe("AppWideTabBar");
  const [route, setRoute] = useState(currentRouteName);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const ownBars = useOwnTabBarCount();

  useEffect(() => {
    const sync = () => setRoute(currentRouteName());
    sync();
    return navigationRef.addListener("state", sync);
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const standDown = !route || NO_BAR.has(route) || ownBars > 0 || keyboardUp;
  // Built the first time a page needs it, then kept and only hidden: building
  // a fresh copy on every push was a fifth of the time a post, the
  // notifications or search took to open.
  const built = useRef(false);
  if (!standDown) built.current = true;
  if (!built.current) return null;
  return (
    <View
      style={standDown ? styles.away : StyleSheet.absoluteFill}
      pointerEvents={standDown ? "none" : "box-none"}
      accessibilityElementsHidden={standDown}
      importantForAccessibility={standDown ? "no-hide-descendants" : "auto"}
    >
      <StandaloneTabBar appWide />
    </View>
  );
}

const styles = StyleSheet.create({
  away: { ...StyleSheet.absoluteFillObject, display: "none" },
});
