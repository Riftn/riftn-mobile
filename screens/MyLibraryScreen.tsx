import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { View, Pressable, StyleSheet, Alert, I18nManager, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import ScreenHeader from "../components/ScreenHeader";
import { PageTabs } from "../components/page/PageKit";
import PostsInfiniteList from "../components/Profile/PostsInfiniteList";
import { useAuthState } from "../context/AuthContext";
import { useGateToHome } from "../hooks/useGateToHome";
import { SwipeBackPan } from "../hooks/useSwipeBack";
import { pageSwipeAllowed, SWIPE_BACK_EDGE } from "../libs/swipe-back";
import type { IconName } from "../components/ui/Icon";
import Icon from "../components/ui/Icon";
import { clearWatchHistory } from "../services/user.service";
import type { AppStackParamList } from "../navigation/types";
import type { ScreenNames } from "../navigation/ScreenNames";

type LibraryTab = "myPosts" | "liked" | "saved" | "unlocked" | "watched";

interface TabDef {
  key: LibraryTab;
  labelKey: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { key: "myPosts", labelKey: "library.myPosts", icon: "LayoutGrid" },
  { key: "liked", labelKey: "bookmarks.liked", icon: "Heart" },
  { key: "saved", labelKey: "nav.bookmarks", icon: "Bookmark" },
  { key: "unlocked", labelKey: "library.unlocked", icon: "LockOpen" },
  { key: "watched", labelKey: "bookmarks.history", icon: "History" },
];

const SWIPE_DISTANCE = 50;
const SWIPE_RATIO = 1.5;

const MyLibraryScreen: React.FC = () => {
  const { t } = useTranslation();
  const { isSignedIn, needsUsername } = useAuthState();
  const allow = isSignedIn && !needsUsername;
  useGateToHome(allow);

  // The menu's Bookmarks entry asks for the "saved" tab; without it the
  // screen opened on My Posts and the reader had to find Bookmarks again.
  const route = useRoute<RouteProp<AppStackParamList, ScreenNames.MyLibrary>>();
  const [activeTab, setActiveTab] = useState<LibraryTab>(route.params?.initialTab ?? "myPosts");
  const [historyKey, setHistoryKey] = useState(0);
  const backPan = useContext(SwipeBackPan);
  const { width } = useWindowDimensions();
  const listSurface = useRef<View>(null);
  const swipeAllowed = useSharedValue(false);
  const swipeStart = useSharedValue({ x: 0, y: 0, decided: false });

  const handleClearHistory = useCallback(() => {
    Alert.alert(
      t("library.clearHistoryTitle"),
      t("library.clearHistoryBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("library.clear"),
          style: "destructive",
          onPress: async () => {
            try {
              await clearWatchHistory();
              setHistoryKey((k) => k + 1);
            } catch {
              Alert.alert(t("toasts.error"), t("library.clearFailed"));
            }
          },
        },
      ],
    );
  }, [t]);

  const handleTabChange = useCallback((key: LibraryTab) => {
    setActiveTab(key);
  }, []);

  const stepTab = useCallback((step: number) => {
    setActiveTab((current) => TABS[TABS.findIndex((tab) => tab.key === current) + step]?.key ?? current);
  }, []);

  const markSwipeTarget = useCallback((event: GestureResponderEvent) => {
    swipeAllowed.value = pageSwipeAllowed(event.target, listSurface.current);
  }, [swipeAllowed]);

  const rtl = I18nManager.isRTL;
  const tabSwipe = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(allow)
      .manualActivation(true)
      .maxPointers(1)
      .onTouchesDown((event, state) => {
        const touch = event.allTouches[0];
        if (!touch || event.numberOfTouches !== 1 ||
            (rtl ? width - touch.absoluteX : touch.absoluteX) <= SWIPE_BACK_EDGE) {
          state.fail();
          return;
        }
        swipeStart.value = { x: touch.absoluteX, y: touch.absoluteY, decided: false };
      })
      .onTouchesMove((event, state) => {
        const touch = event.allTouches[0];
        if (!touch || event.numberOfTouches !== 1) { state.fail(); return; }
        const origin = swipeStart.value;
        if (origin.decided) return;
        const dx = Math.abs(touch.absoluteX - origin.x);
        const dy = Math.abs(touch.absoluteY - origin.y);
        if (Math.max(dx, dy) < 14) return;
        swipeStart.value = { ...origin, decided: true };
        if (swipeAllowed.value && dx >= dy * SWIPE_RATIO) state.activate();
        else state.fail();
      })
      .onEnd((event, success) => {
        const { translationX: dx, translationY: dy } = event;
        if (!success || Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
        runOnJS(stepTab)((rtl ? dx > 0 : dx < 0) ? 1 : -1);
      });
    // Inside the content, decide the tab swipe before the screen-wide back pan.
    if (backPan) pan.blocksExternalGesture(backPan);
    return pan;
  }, [allow, backPan, rtl, stepTab, swipeAllowed, swipeStart, width]);

  // Arriving again while the screen is still mounted (React Navigation reuses
  // it) moves to the requested tab. Keyed on the params object, as DpayScreen
  // does, so a repeat tap still lands after the reader switched tabs by hand.
  const routeParams = route.params;
  useEffect(() => {
    if (routeParams?.initialTab) handleTabChange(routeParams.initialTab);
  }, [routeParams, handleTabChange]);

  return (
    <View className="flex-1 bg-theme-neutrals-900">
      <ScreenHeader
        icon="bookmarks"
        title={t("screens.myLibrary")}
        rightContent={
          activeTab === "watched" ? (
            <Pressable
              onPress={handleClearHistory}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("library.clearHistoryTitle")}
              className="bg-theme-neutrals-800"
              style={styles.headerBtn}
            >
              <Icon name="Trash2" size={18} color="#F4F4F5" />
            </Pressable>
          ) : undefined
        }
        tabs={
          <PageTabs
            value={activeTab}
            onChange={handleTabChange}
            tabs={TABS.map((tab) => ({
              id: tab.key,
              label: t(tab.labelKey),
              icon: (ink: string) => <Icon name={tab.icon} size={14} color={ink} />,
            }))}
            style={{ paddingBottom: 10 }}
          />
        }
      />

      <GestureDetector gesture={tabSwipe}>
        <View ref={listSurface} collapsable={false} style={styles.list} onTouchStart={markSwipeTarget}>
          <PostsInfiniteList
            key={activeTab === "watched" ? `watched-${historyKey}` : activeTab}
            variant={activeTab}
            bottomPadding={80}
          />
        </View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  list: { flex: 1 },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default MyLibraryScreen;
