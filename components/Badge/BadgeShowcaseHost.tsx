/**
 * Mounted once beside the navigator. Renders nothing until a badge is
 * tapped; living up here keeps the showcase out of the card it was opened
 * from, so taps inside it never reach a feed card or profile row.
 */
import React, { useEffect, useState } from "react";
import { InteractionManager, Platform, StatusBar } from "react-native";
import { assetDataUrl, loadBadgePage } from "./StickerStage";
import { BADGE_ORDER, badgeImage } from "../../libs/misc";
import BadgeShowcase from "./BadgeShowcase";
import StreamerShowcase from "./StreamerShowcase";
import { closeBadgeShowcase, useBadgeShowcaseRequest } from "../../libs/badgeShowcase";
import { useAppTheme } from "../../context/ThemeContext";
import { setNavigationBarDarkIcons } from "../../modules/system-bars";

export default function BadgeShowcaseHost() {
  const request = useBadgeShowcaseRequest();
  useEffect(() => {
    const work = InteractionManager.runAfterInteractions(() => {
      void loadBadgePage().catch(() => {});
      // Read local assets while idle, before a tap needs the WebView payload.
      void (async () => {
        for (const tier of BADGE_ORDER) {
          const art = badgeImage(tier, "light") ?? badgeImage(tier);
          if (art !== undefined) await assetDataUrl(art).catch(() => {});
        }
      })();
    });
    return () => work.cancel();
  }, []);
  // The showcase is a black stage in its own window, and a window takes its
  // clock and gesture bar colours from the app at the moment it opens. On a
  // light theme those are dark, on black. Turn them light first, then open.
  const { isLight } = useAppTheme();
  const open = !!request;
  const [barsReady, setBarsReady] = useState(false);
  useEffect(() => {
    if (!open || !isLight) return;
    let live = true;
    StatusBar.setBarStyle("light-content");
    const bars = Platform.OS === "android" ? setNavigationBarDarkIcons(false) : null;
    Promise.resolve(bars).catch(() => {}).then(() => { if (live) setBarsReady(true); });
    return () => {
      live = false;
      setBarsReady(false);
      StatusBar.setBarStyle("dark-content");
      if (Platform.OS === "android") void setNavigationBarDarkIcons(true);
    };
  }, [open, isLight]);
  if (!request || (isLight && !barsReady)) return null;
  if (request.kind === "streamer") {
    return (
      <StreamerShowcase
        key={request.id}
        badgeId={request.badgeId}
        address={request.address}
        canSelect={request.canSelect}
        anchor={request.anchor}
        onClose={closeBadgeShowcase}
      />
    );
  }
  return (
    <BadgeShowcase
      key={request.id}
      tier={request.tier}
      promotedFrom={request.promotedFrom}
      anchor={request.anchor}
      onClose={closeBadgeShowcase}
    />
  );
}
