import Icon from "../ui/Icon";
import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { SpotifyLogo } from "../common/SpotifyCard";
import type { GridCardKind } from "../../libs/gridCard";

/**
 * FormatMark
 * ==========
 * One small custom icon per post format (photo, video, short, comic, song,
 * stage, poll...), in the same top-right spot on every profile grid tile. It
 * replaces the old word pills ("Comic", "Short", "Earn") and the stock icons
 * in glass circles. The glyph sits bare, with a soft outline over pictures.
 * Same glyphs as the web grid
 * (components/app/profile/FormatMark).
 */

export type FormatKind = GridCardKind | "photo" | "photos" | "video" | "replay" | "audio" | "article" | "text";

const LIVE_RED = "#FF2D55";

/** Each glyph: the shape that takes the duotone wash, then the lines on top. */
const GLYPHS: Record<Exclude<FormatKind, 'photo' | 'video' | 'short' | 'text'>, { wash?: React.ReactNode; lines: React.ReactNode }> = {
  photos: {
    wash: <Rect x="3" y="7" width="14" height="14" rx="3" />,
    lines: (
      <>
        <Path d="M7.5 3H18a3 3 0 0 1 3 3v10.5" />
        <Rect x="3" y="7" width="14" height="14" rx="3" />
        <Path d="M6 18l3.2-3.4 2.3 2.3 1.4-1.4 1.6 2.5" />
      </>
    ),
  },
  replay: {
    wash: <Circle cx="12" cy="12" r="3" />,
    lines: (
      <>
        <Path d="M4.4 9.2A8 8 0 1 1 4 12" />
        <Path d="M3.6 5.2v4.3h4.3" />
        <Circle cx="12" cy="12" r="2.6" fill="currentColor" />
      </>
    ),
  },
  audio: {
    wash: <Circle cx="12" cy="12" r="9" />,
    lines: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Circle cx="12" cy="12" r="2.4" />
        <Path d="M12 6.2a5.8 5.8 0 0 1 5.8 5.8" />
      </>
    ),
  },
  article: {
    wash: <Path d="M6.5 2.5H14l5 5v11.5a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 4 19V5a2.5 2.5 0 0 1 2.5-2.5z" />,
    lines: (
      <>
        <Path d="M6.5 2.5H14l5 5v11.5a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 4 19V5a2.5 2.5 0 0 1 2.5-2.5z" />
        <Path d="M14 2.5v5h5" />
        <Path d="M7.5 12h7M7.5 15.3h8M7.5 18.5h4.5" />
      </>
    ),
  },
  comic: {
    lines: <Path d="M3 3h13q5 0 5 5v13H8q-5 0-5-5ZM14 3l-5 18" strokeLinejoin="miter" />,
  },
  earn: {
    wash: <Circle cx="10.5" cy="13.5" r="7.5" />,
    lines: (
      <>
        <Circle cx="10.5" cy="13.5" r="7.5" />
        <Circle cx="10.5" cy="13.5" r="3.6" />
        <Path d="M19.5 2.5v4.6M17.2 4.8h4.6" />
      </>
    ),
  },
  stage: {
    wash: <Rect x="9" y="2.5" width="6" height="11" rx="3" />,
    lines: (
      <>
        <Rect x="9" y="2.5" width="6" height="11" rx="3" />
        <Path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M9 21h6" />
      </>
    ),
  },
  event: {
    wash: <Path d="M3 9.5h18V18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />,
    lines: (
      <>
        <Rect x="3" y="4.5" width="18" height="16.5" rx="3" />
        <Path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        <Circle cx="12" cy="15.2" r="2" fill="currentColor" />
      </>
    ),
  },
  poll: {
    wash: <Rect x="3" y="10" width="18" height="4" rx="2" />,
    lines: (
      <>
        <Rect x="3" y="4" width="11" height="4" rx="2" />
        <Rect x="3" y="10" width="18" height="4" rx="2" />
        <Rect x="3" y="16" width="7" height="4" rx="2" />
      </>
    ),
  },
  quote: {
    wash: (
      <>
        <Circle cx="7" cy="14.5" r="3" />
        <Circle cx="17" cy="14.5" r="3" />
      </>
    ),
    lines: (
      <>
        <Circle cx="7" cy="14.5" r="3" />
        <Circle cx="17" cy="14.5" r="3" />
        <Path d="M4 14.5c0-4.2 2-7.2 5.5-8.3M14 14.5c0-4.2 2-7.2 5.5-8.3" />
      </>
    ),
  },
  sharedPost: {
    wash: <Rect x="3" y="7.5" width="12" height="13.5" rx="2.5" />,
    lines: (
      <>
        <Path d="M15 13.5V18.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 3 18.5v-8.5A2.5 2.5 0 0 1 5.5 7.5H10" />
        <Path d="M11 13L20.5 3.5M14.8 3.5h5.7v5.7" />
      </>
    ),
  },
  link: {
    lines: (
      <>
        <Path d="M10 14a4 4 0 0 0 5.7 0l3.1-3.1a4 4 0 0 0-5.7-5.7l-1 1" />
        <Path d="M14 10a4 4 0 0 0-5.7 0l-3.1 3.1a4 4 0 0 0 5.7 5.7l1-1" />
      </>
    ),
  },
  community: {
    wash: <Circle cx="12" cy="8" r="3.2" />,
    lines: (
      <>
        <Circle cx="12" cy="8" r="3.2" />
        <Circle cx="5" cy="10" r="2.2" />
        <Circle cx="19" cy="10" r="2.2" />
        <Path d="M6.5 20.5a5.5 5.5 0 0 1 11 0M1.8 18.6a3.4 3.4 0 0 1 4.2-3.2M22.2 18.6a3.4 3.4 0 0 0-4.2-3.2" />
      </>
    ),
  },
  shop: {
    wash: <Path d="M5 8h14l-1 12.4a1.6 1.6 0 0 1-1.6 1.4H7.6A1.6 1.6 0 0 1 6 20.4z" />,
    lines: (
      <>
        <Path d="M5 8h14l-1 12.4a1.6 1.6 0 0 1-1.6 1.4H7.6A1.6 1.6 0 0 1 6 20.4z" />
        <Path d="M9 10.5V6.5a3 3 0 0 1 6 0v4" />
      </>
    ),
  },
  profile: {
    wash: <Rect x="2.5" y="5" width="19" height="14" rx="3" />,
    lines: (
      <>
        <Rect x="2.5" y="5" width="19" height="14" rx="3" />
        <Circle cx="8.5" cy="10.6" r="2.1" />
        <Path d="M5.5 15.8a3 3 0 0 1 6 0M14.2 10h4.3M14.2 13.4h2.8" />
      </>
    ),
  },
  film: {
    wash: <Rect x="3" y="9.5" width="18" height="11.5" rx="2.5" />,
    lines: (
      <>
        <Rect x="3" y="9.5" width="18" height="11.5" rx="2.5" />
        <Path d="M3.3 9.4l-.5-2.8a1.5 1.5 0 0 1 1.2-1.7l13.6-2.4a1.5 1.5 0 0 1 1.7 1.2l.5 2.6M8 4.8l2.4 3.6M13.3 3.9l2.4 3.6" />
      </>
    ),
  },
  bounty: {
    wash: <Circle cx="12" cy="12" r="5.5" />,
    lines: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Circle cx="12" cy="12" r="5.5" />
        <Circle cx="12" cy="12" r="1.8" fill="currentColor" />
      </>
    ),
  },
  app: {
    wash: <Circle cx="17.5" cy="17.5" r="3.5" />,
    lines: (
      <>
        <Rect x="3" y="3" width="7.5" height="7.5" rx="2.2" />
        <Rect x="13.5" y="3" width="7.5" height="7.5" rx="2.2" />
        <Rect x="3" y="13.5" width="7.5" height="7.5" rx="2.2" />
        <Circle cx="17.25" cy="17.25" r="3.75" />
      </>
    ),
  },
  proposal: {
    wash: <Path d="M3.5 13.5h17v6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
    lines: (
      <>
        <Path d="M3.5 13.5h17v6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM7.5 13.5V4a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 16.5 4v9.5" />
        <Path d="M10 8l1.6 1.6L14.4 6.8" />
      </>
    ),
  },
  spotify: { lines: null },
};

/** Screen-reader name per format, from keys the app already has. */
const LABEL: Record<FormatKind, [string, string]> = {
  photo: ["dm.photo", "Photo"],
  photos: ["profile.tabImages", "Images"],
  video: ["dm.video", "Video"],
  short: ["profile.gridCard.short", "Short"],
  replay: ["profile.tabLive", "Live"],
  audio: ["profile.tabAudio", "Audio"],
  article: ["profile.articleShort", "Article"],
  text: ["profile.post", "Post"],
  comic: ["profile.gridCard.comic", "Comic"],
  earn: ["profile.gridCard.earn", "Earn"],
  stage: ["profile.gridCard.stage", "Stage"],
  event: ["profile.gridCard.event", "Event"],
  poll: ["profile.gridCard.poll", "Poll"],
  quote: ["profile.gridCard.quote", "Quote"],
  sharedPost: ["profile.gridCard.shared", "Shared"],
  link: ["profile.gridCard.link", "Link"],
  community: ["profile.gridCard.community", "Community"],
  shop: ["profile.gridCard.shop", "Shop"],
  profile: ["profile.gridCard.profile", "Profile"],
  film: ["profile.gridCard.film", "Film"],
  bounty: ["profile.gridCard.bounty", "Bounty"],
  app: ["profile.gridCard.app", "App"],
  proposal: ["profile.gridCard.proposal", "Proposal"],
  spotify: ["", "Spotify"],
};

/** Just the glyph, drawn at `size` in `color`; `wash` is the duotone fill strength. */
export function FormatGlyph({ kind, size, color, wash = 0, strokeWidth = 1.8, halo }: { kind: FormatKind; size: number; color: string; wash?: number; strokeWidth?: number; halo?: string }) {
  if (kind === "spotify") return <SpotifyLogo size={size} />;
  if (kind === 'photo' || kind === 'video' || kind === 'short' || kind === 'text') {
    const name = { photo: 'Image', video: 'Video', short: 'Shorts', text: 'MessageSquare' } as const;
    return <View style={halo ? { shadowColor: halo, shadowOpacity: 0.8, shadowRadius: 1, shadowOffset: { width: 0, height: 1 } } : undefined}><Icon name={name[kind]} size={size} color={color} /></View>;
  }
  const glyph = GLYPHS[kind];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* A soft dark outline under the lines keeps a white glyph readable on bright pictures (works on Android, where view shadows don't). */}
      {halo ? <G color={halo} stroke={halo} strokeWidth={strokeWidth + 2.2} opacity={0.45}>{glyph.lines}</G> : null}
      <G color={color} stroke={color} strokeWidth={strokeWidth}>
        {glyph.wash && wash > 0 ? <G fill={color} stroke="none" opacity={wash}>{glyph.wash}</G> : null}
        {glyph.lines}
      </G>
    </Svg>
  );
}

/** Ink of the poster tile the mark sits on; leave it out over a picture. */
export interface FormatInk {
  ink: string;
  glass: string;
  line: string;
}

/** The mark on a tile, named for screen readers. `live` adds the red dot. */
export function FormatMark({ kind, live, poster }: { kind: FormatKind; live?: boolean; poster?: FormatInk }) {
  const { t } = useTranslation();
  const [key, label] = LABEL[kind];
  const name = live ? t("profile.gridCard.liveStage", "Live stage") : key ? t(key, label) : label;
  return (
    <View style={styles.mark} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={name}>
      <FormatGlyph kind={kind} size={16} color={poster ? poster.ink : "#FFFFFF"} halo={poster ? undefined : "#000000"} />
      {live ? <View style={styles.dot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { position: "absolute", top: 5, right: 5, zIndex: 2, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: -1, right: -1, width: 7, height: 7, borderRadius: 4, backgroundColor: LIVE_RED, borderWidth: 1, borderColor: "rgba(0,0,0,0.35)" },
});
