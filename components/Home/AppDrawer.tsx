import { useDraftState } from '../../hooks/useDraftState';
/** The key useSurfaceDraft gave this field on the App screen, so a saved query survives the switch. */
const MENU_QUERY_DRAFT = `field:${JSON.stringify(["components/Home/AppDrawer.tsx:menuQuery", JSON.stringify(["App", []])])}`;
import { SEARCH_INPUT_CLEAR, useSearchFieldMaterial } from '../../hooks/useSearchFieldMaterial';
import { DIGITAL_PURCHASES_ENABLED } from "../../config/storefront";
import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Alert,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  BackHandler,
  Keyboard,
  Platform,
  Image as RNImage,
} from "react-native";
import { GRAIN, glassTint, type ThemeSkin } from "../../theme/skins";
import HudBrackets from "../theme/HudBrackets";
import FrostedPill from "../ui/FrostedPill";
import SheetBackdrop, { useSheetBackdrop } from "../ui/SheetBackdrop";
import { SheetGlassFill } from "../ui/SheetGlass";
import { SHEET_GLASS_FILL } from "../../theme/sheetGlass";
import { Image } from "expo-image";
import { CommonActions, useNavigation, useNavigationState } from "@react-navigation/native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedReaction,
  type SharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
  interpolate,
} from "react-native-reanimated";
import Avatar from "../common/Avatar";
import MenuAccountSwitcher from "./MenuAccountSwitcher";
import { DhbCoin } from "../common/DhbCoin";
import Icon, { type IconName } from "../ui/Icon";
import { formatCompactNumber } from "../../libs/numbers.util";
import { HIDDEN_BALANCE, setBalanceHidden, useBalanceHidden } from "../../libs/balancePrivacy";
import { filterNavRows } from "../../libs/navSearch";
import { useUser, useAuthState, useAuthActions } from "../../context/AuthContext";
import { canManageAgents } from '../../libs/agent-access';
import { useTotalUnreadMessagesCount } from "../../store/dm.store";
import { usePublicChatUnreadCount } from "../../hooks/usePublicChatUnread";
import { ScreenNames } from "../../navigation/ScreenNames";
import { WEBSITE_LINK } from "../../config/links";
import { getAvatarUrl, getBadgeUrlFor, getBadgeHoverOpticalStyle as getBadgeOpticalStyle } from "../../libs/misc";
import BadgeArtwork from "../common/BadgeArtwork";
import { toastError, toastInfo } from "../../libs";
import { openInApp } from "../../libs/links.utils";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../context/ThemeContext";
import { themeIconUrl } from "../../theme/icons";
import { ReorderItem, justDropped, useReorder, type ReorderCtx } from "../common/Reorder";
import { usePerfProbe, perfPropsEqual } from "../../libs/perfTrace";
import { applyNavOrder, navOrderId, resetNavOrder, saveNavOrder, useNavOrder, toggleHomeShortcut } from "../../libs/navOrder";
import SearchRequestPrompt from "../Search/SearchRequestPrompt";
import { useAppPrefs } from "../../hooks/useAppPrefs";
import { defaultMenuGroupOf, groupMenuItems, type MenuGroup } from "../../libs/menuGroups";
import { moveMenuTile, saveMenuGroupMoves, useMenuGroupMoves } from "../../libs/menuGroupMoves";

// The menu is a bottom sheet: grab handle, who is signed in, the search field,
// then a four-column grid of the same glossy 3D icons the web menu uses. It
// rises from the bottom in every locale, so there is no RTL mirroring to get
// wrong the way the old side drawer had to.

const OPEN_TIMING = { duration: 300, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };
const CLOSE_TIMING = { duration: 220, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };
const TAB_TIMING = { duration: 280, easing: Easing.bezier(0.16, 1, 0.3, 1) };

const VELOCITY_THRESHOLD = 500;
// Fraction of the sheet height a downward drag has to cover to count as a close.
const POSITION_THRESHOLD = 0.3;
// Web caps its sheet at 85dvh; same here.
const SHEET_HEIGHT_RATIO = 0.85;

const GRID_GAP = 8;
const GRID_PADDING = 16;
const GRID_COLUMNS = 4;
// The sheet's 1px left and right borders sit inside the screen width.
const SHEET_BORDER_X = 2;
const ICON_SIZE = 44;
// Tabs and Folders lay the menu out three a row with bigger art (libs/menuLayout).
const BIG_COLUMNS = 3;
const BIG_ICON_SIZE = 58;
const BIG_TILE_HEIGHT = 104;

// Per-theme 3D artwork is served by the website (public/theme-icons/<theme>/),
// the same files the web menu draws, so both stay on one set. expo-image keeps
// them in its disk cache after the first open.

interface DrawerItem {
  icon: IconName;
  /** i18n key for the label (resolved with t() at render). */
  labelKey: string;
  screen?: string;
  params?: Record<string, any>;
  url?: string;
  requiresAuth?: boolean;
  /** Left out of the App Store build — see config/storefront. */
  storefrontHidden?: boolean;
  /** Screen lives inside the bottom-tab navigator (Root), so it needs nested navigation. */
  tab?: boolean;
  /**
   * Only listed while the menu search matches it — web's SEARCH_ONLY_ITEMS.
   * A real page reached from inside another one (Bridge from the wallet), so
   * the resting menu stays the length it is.
   */
  searchOnly?: boolean;
  disabled?: boolean;
  disabledMessage?: string;
}

// Mirrors the web sidebar (NAV_ITEMS in cosmic-echo-hero's app.constants) —
// same order, labels and icons. Items with a native screen navigate in-app;
// the rest open the corresponding page on the website.
const NAV_ITEMS: DrawerItem[] = [
  // Search-only: Home and its feed tabs are already on the main screen twice.
  { icon: "House", labelKey: "nav.home", screen: ScreenNames.Home, tab: true, searchOnly: true },
  { icon: "User", labelKey: "nav.profile", screen: ScreenNames.Profile, requiresAuth: true },
  { icon: "Search", labelKey: "nav.explore", screen: ScreenNames.Explore, tab: true },
  { icon: "Wand", labelKey: "nav.prompt", screen: ScreenNames.Prompt },
  { icon: "Bell", labelKey: "nav.notifications", screen: ScreenNames.Notifications, requiresAuth: true },
  { icon: "MessageSquare", labelKey: "nav.messages", screen: ScreenNames.DM, requiresAuth: true, tab: true },
  { icon: "Users", labelKey: "nav.communities", screen: ScreenNames.Communities },
  { icon: "Sparkles", labelKey: "nav.assistant", screen: ScreenNames.AIChat, tab: true },
  { icon: "SettingsCog", labelKey: "nav.settings", screen: ScreenNames.AccountSettings, requiresAuth: true },
  { icon: "Film", labelKey: "creator.editor", screen: ScreenNames.MediaEditor },
  { icon: "Creator", labelKey: "commandCentre.creator", screen: ScreenNames.Creator },
  { icon: "Trophy", labelKey: "nav.leaderboard", screen: ScreenNames.Leaderboard },
  { icon: "ChartColumn", labelKey: "nav.stats", screen: ScreenNames.Stats },
  { icon: "Bookmark", labelKey: "nav.bookmarks", screen: ScreenNames.MyLibrary, params: { initialTab: "saved" }, requiresAuth: true },
  { icon: "LayoutDashboard", labelKey: "nav.command", screen: ScreenNames.CommandCentre, requiresAuth: true, storefrontHidden: true },
  // Passes initialTab explicitly so returning here from the Staking entry
  // (same screen, different tab) resets to Buy instead of keeping Stake.
  { icon: "Wallet", labelKey: "nav.wallet", screen: ScreenNames.Dpay, params: { initialTab: "wallet" }, requiresAuth: true, storefrontHidden: true },
  { icon: "CalendarDays", labelKey: "nav.events", screen: ScreenNames.Events },
  { icon: "Mic", labelKey: "nav.stages", screen: ScreenNames.Stages },
  { icon: "Lightbulb", labelKey: "nav.featureRequests", screen: ScreenNames.FeatureRequests },
  { icon: "MessageSquare", labelKey: "stats.feedback.title", screen: ScreenNames.Feedback },
  // Staking lives as a tab inside the wallet (Dpay) screen rather than its own
  // route, so it deep-links there. Web has it as a separate sidebar entry.
  { icon: "Vault", labelKey: "nav.staking", screen: ScreenNames.Dpay, params: { initialTab: "stake" }, requiresAuth: true, storefrontHidden: true },
  // Powers unlocked by holding DHB: hidden in the App Store build, where
  // crypto may not unlock features (guideline 3.1.1).
  { icon: "Zap", labelKey: "nav.superpowers", screen: ScreenNames.SuperPowers, storefrontHidden: true },
  // Emoji, sticker and GIF packs — creating one is a badge perk, so it sits with
  // the other things staking buys. Browsing and adding packs is open to all.
  { icon: "Smile", labelKey: "creatorPacks.title", screen: ScreenNames.Packs },
  { icon: "Vote", labelKey: "nav.governance", screen: ScreenNames.Governance, storefrontHidden: true },
  { icon: "Landmark", labelKey: "nav.dao", screen: ScreenNames.Dao, storefrontHidden: true },
  { icon: "Hammer", labelKey: "screens.work", screen: ScreenNames.Work, storefrontHidden: true },
  { icon: "Handshake", labelKey: "nav.affiliate", screen: ScreenNames.Affiliate, requiresAuth: true, storefrontHidden: true },
  { icon: "Briefcase", labelKey: "nav.careers", screen: ScreenNames.Careers },
  // Search-only on the web sidebar; here it sits beside Careers, which links
  // to it for the ambassador role.
  { icon: "Star", labelKey: "nav.creators", screen: ScreenNames.Creators },
  { icon: "Store", labelKey: "screens.stores", screen: ScreenNames.Stores, storefrontHidden: true },
  { icon: "ChartPie", labelKey: "nav.fractions", screen: ScreenNames.Fractions, storefrontHidden: true },
  // The NFT market is the Fractions screen's NFTs tab. Android reaches it
  // from the Fractions row (this one only shows for a menu search like
  // "nft"). The iPhone app leaves NFTs out entirely (App Store 3.1.1).
  { icon: "Gem", labelKey: "nav.nfts", screen: ScreenNames.Fractions, params: { tab: "nfts" }, searchOnly: true, storefrontHidden: true },
  { icon: "AtSign", labelKey: "screens.usernames", screen: ScreenNames.Usernames, storefrontHidden: true },
  { icon: "IdCard", labelKey: "screens.accounts", screen: ScreenNames.Accounts, storefrontHidden: true },
  // Web sidebar: AI Agents sits just above Advertising.
  { icon: "Bot", labelKey: "nav.agents", screen: ScreenNames.Agents },
  { icon: "Megaphone", labelKey: "nav.ads", screen: ScreenNames.Ads, requiresAuth: true, storefrontHidden: true },
  { icon: "Tv", labelKey: "nav.tv", screen: ScreenNames.TV, storefrontHidden: true },
  { icon: "LayoutGrid", labelKey: "miniApps.store.title", screen: ScreenNames.Apps, storefrontHidden: true },
  // Sits between Stores and Glossary, as on the web sidebar. Only the games
  // that work on a touchscreen are listed — see config/arcade-games.
  { icon: "Gamepad2", labelKey: "nav.arcade", screen: ScreenNames.Arcade },
  // The third-party mini app store has its own storefront review pending.
  { icon: "ArrowDownToLine", labelKey: "nav.converter", screen: ScreenNames.Converter, requiresAuth: true, storefrontHidden: true },
  { icon: "FolderInput", labelKey: "nav.migrate", screen: ScreenNames.Migrate, storefrontHidden: true },
  { icon: "Scroll", labelKey: "nav.glossary", screen: ScreenNames.Glossary },
  { icon: "Scroll", labelKey: "Compare Riftn", screen: ScreenNames.Compare, storefrontHidden: true },
  { icon: "Map", labelKey: "nav.guide", screen: ScreenNames.Guide },
  { icon: "Plug", labelKey: "nav.connectAi", screen: ScreenNames.Connect },
  { icon: "ArrowLeftRight", labelKey: "nav.bridge", screen: ScreenNames.Bridge, searchOnly: true, storefrontHidden: true },
  { icon: "BookOpen", labelKey: "nav.docs", url: `${WEBSITE_LINK}/docs`, storefrontHidden: true },
  { icon: "Blog", labelKey: "nav.blog", url: `${WEBSITE_LINK}/docs/blog`, storefrontHidden: true },
  // Search-only on web too. Hidden on iOS: both pages exist to sell a plan.
  { icon: "Crown", labelKey: "nav.premium", screen: ScreenNames.Premium, storefrontHidden: true, searchOnly: true },
  { icon: "Tag", labelKey: "nav.pricing", screen: ScreenNames.Pricing, storefrontHidden: true, searchOnly: true },
  // More search-only pages, the same ones the web menu search reveals.
  { icon: "Trophy", labelKey: "top100.title", screen: ScreenNames.Top100, searchOnly: true },
  { icon: "Hammer", labelKey: "work.myBounties", screen: ScreenNames.WorkHistory, requiresAuth: true, storefrontHidden: true, searchOnly: true },
  { icon: "Wallet", labelKey: "buyCoins.title", screen: ScreenNames.Dpay, params: { initialTab: "buy" }, requiresAuth: true, storefrontHidden: true, searchOnly: true },
  { icon: "MessageSquare", labelKey: "publicChat.title", screen: ScreenNames.LiveChat, searchOnly: true },
  { icon: "CalendarDays", labelKey: "planned.title", screen: ScreenNames.Planned, requiresAuth: true, searchOnly: true },
  { icon: "Tv", labelKey: "liveStudio.title", screen: ScreenNames.LiveStudio, requiresAuth: true, searchOnly: true },
  { icon: "ChartColumn", labelKey: "launchpad.title", screen: ScreenNames.Launchpad, storefrontHidden: true, searchOnly: true },
];

/** Default menu order as saved ids (libs/navOrder): what a first drag merges into. */
const DEFAULT_MENU_IDS = NAV_ITEMS.filter((item) => !item.searchOnly).map((item) => navOrderId(item.labelKey));

// Row → 3D artwork (web ThemeIconKey). Rows without a bespoke render borrow the
// closest one: a flat glyph beside the glossy set reads as a broken tile, so
// the glyph is only the fallback for art that fails to download.
// Theme artwork belongs to phone menus. The web desktop sidebar keeps its
// custom vectors for Editor and Creator.
const ICON_KEYS: Record<string, string> = {
  "Compare Riftn": "glossary",
  "creator.editor": "videos", "commandCentre.creator": "paint",
  "nav.home": "home", "nav.profile": "profile", "nav.explore": "search", "nav.prompt": "wand",
  "nav.notifications": "notifications", "nav.messages": "messages", "nav.communities": "communities",
  "nav.assistant": "assistant", "nav.settings": "settings", "nav.leaderboard": "trophy",
  "nav.stats": "stats", "nav.bookmarks": "bookmarks", "nav.command": "command", "nav.events": "events",
  "stats.feedback.title": "messages", "nav.stages": "stages", "nav.featureRequests": "features", "nav.staking": "staking",
  "nav.superpowers": "superpowers", "nav.governance": "governance", "nav.dao": "dao",
  "screens.work": "bounties", "nav.careers": "careers", "screens.stores": "stores",
  "nav.fractions": "fractions", "nav.nfts": "nfts", "screens.usernames": "usernames", "screens.accounts": "accounts",
  "nav.ads": "ads", "nav.tv": "tv", "nav.arcade": "arcade", "miniApps.store.title": "stores", "nav.glossary": "glossary", "nav.bridge": "bridge",
  "nav.wallet": "buy", "creatorPacks.title": "images", "nav.affiliate": "subscriptions",
  "nav.creators": "subscriptions", "nav.agents": "assistant", "nav.converter": "videos",
  "nav.migrate": "bridge", "nav.guide": "pinned", "nav.connectAi": "command", "nav.docs": "posts",
  "nav.blog": "email", "nav.premium": "boost", "nav.pricing": "buy",
  "top100.title": "trophy", "work.myBounties": "bounties", "buyCoins.title": "buy", "publicChat.title": "messages",
  "planned.title": "events", "liveStudio.title": "live", "launchpad.title": "buy",
};

/** What the themes layer hands us; null for system/minimal (dark glass). */
type SheetSkin = ThemeSkin;

/**
 * One label size for the whole grid. Each tile used to shrink its own long
 * word to fit, so "Notifications" and "Communities" sat smaller than "Home"
 * beside them. The widest single word is measured once (hidden, off screen),
 * every label takes the size that word needs, and the result is kept for the
 * session per font scale, tile width and language.
 */
const TILE_LABEL_SIZE = 11.5;
const TILE_LABEL_MIN_SCALE = 0.87;
// Tile paddingHorizontal (4) each side, plus its 1px border each side.
const TILE_LABEL_INSET = 10;
const labelScaleCache = new Map<string, number>();

function useTileLabelSize(labels: string[], tileWidth: number) {
  const avail = tileWidth - TILE_LABEL_INSET;
  const words = useMemo(() => Array.from(new Set(labels.filter((label) => !label.includes(" ")))), [labels]);
  const { fontScale = 1 } = useWindowDimensions();
  const key = `${fontScale}|${avail}|${words.join("\u0001")}`;
  const [scale, setScale] = useState<number | undefined>(() => labelScaleCache.get(key));
  const widths = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    widths.current = new Map();
    setScale(labelScaleCache.get(key));
  }, [key]);
  const report = useCallback((word: string, width: number) => {
    widths.current.set(word, width);
    if (widths.current.size < words.length) return;
    const widest = Math.max(...widths.current.values());
    const next = Math.max(TILE_LABEL_MIN_SCALE, Math.min(1, avail / Math.max(widest, 1)));
    labelScaleCache.set(key, next);
    setScale(next);
  }, [avail, key, words.length]);
  const measurer = scale === undefined && words.length > 0 ? (
    <View pointerEvents="none" style={styles.labelMeasure} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {words.map((word) => (
        <Text key={word} style={[styles.tileLabel, styles.labelMeasureText]} onLayout={(e) => report(word, e.nativeEvent.layout.width)}>
          {word}
        </Text>
      ))}
    </View>
  ) : null;
  return { size: TILE_LABEL_SIZE * (scale ?? 1), measurer };
}

interface TileProps {
  /** Three-a-row tile (Tabs and Folders layouts): bigger art and name. */
  big?: boolean;
  label: string;
  /** The grid's shared label size (useTileLabelSize). */
  labelSize?: number;
  icon: IconName;
  iconUrl?: string;
  iconColor?: string;
  width: number;
  active?: boolean;
  badgeCount?: number;
  disabled?: boolean;
  soonLabel: string;
  skin: SheetSkin | null;
  /** War keeps its tactical HUD frame and offline fallback colour. */
  hud: boolean;
  square: boolean;
  /** Held up by a drag (components/common/Reorder). */
  lifted?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

/** Tile artwork URLs that have been on screen at least once. */
const shownTileArt = new Set<string>();

const Tile = memo<TileProps>(({ big = false, label, labelSize, icon, iconUrl, iconColor, width, active, badgeCount = 0, disabled, soonLabel, skin, hud, square, lifted, onPress, onLongPress }) => {
  const glyphColor = iconColor ?? (hud
    ? skin?.glow ?? "#22D3EE"
    : active ? skin?.tabIconActive ?? "#FFFFFF" : skin?.tabIcon ?? "rgba(255,255,255,0.9)");
  // Offline or a failed download would otherwise leave an empty tile.
  const [artFailed, setArtFailed] = useState(false);
  // The glyph stays until the artwork reports it is on screen: on some Android
  // phones the download came back blank without an error, leaving empty tiles.
  // Artwork already drawn once this session comes straight back (memory cache)
  // when a tab change remounts the tile: no glyph swap, no fade, no flicker.
  const [artShown, setArtShown] = useState(() => !!iconUrl && shownTileArt.has(iconUrl));
  const lastIconUrl = useRef(iconUrl);
  useEffect(() => {
    if (lastIconUrl.current === iconUrl) return;
    lastIconUrl.current = iconUrl;
    setArtFailed(false);
    setArtShown(!!iconUrl && shownTileArt.has(iconUrl));
  }, [iconUrl]);
  const artWasShown = !!iconUrl && shownTileArt.has(iconUrl);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      activeOpacity={disabled ? 1 : 0.7}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.tile,
        big && styles.tileBig,
        { width },
        Platform.OS === "android" ? skin?.strip : skin?.card,
        active && styles.tileActive,
        active && skin?.stripActive,
        square && styles.square,
        disabled ? { opacity: 0.45 } : null,
        lifted && styles.tileLifted,
      ]}
    >
      {Platform.OS !== "android" && skin?.grain ? (
        <RNImage
          source={GRAIN}
          resizeMode="repeat"
          style={[StyleSheet.absoluteFill, { borderRadius: skin.card.borderRadius }]}
        />
      ) : null}
      {skin?.brackets ? <HudBrackets color={skin.brackets} length={8} width={1} /> : null}
      <View style={[styles.tileIcon, big && styles.tileIconBig]}>
        {!(iconUrl && !artFailed && artShown) ? (
          <Icon name={icon} size={big ? 34 : 26} color={glyphColor} strokeWidth={1.6} />
        ) : null}
        {iconUrl && !artFailed ? (
          <Image
            source={{ uri: iconUrl }}
            style={[styles.tileImage, big && styles.tileIconBig, !artShown && StyleSheet.absoluteFill]}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={artWasShown ? 0 : 120}
            onDisplay={() => { if (iconUrl) shownTileArt.add(iconUrl); setArtShown(true); }}
            onError={() => setArtFailed(true)}
          />
        ) : null}
        {badgeCount > 0 && (
          <View className="dark-surface" style={{ position: "absolute", top: -3, right: -5, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#ffffff", fontSize: 10, fontWeight: "700" }}>
              {badgeCount > 99 ? "99+" : badgeCount}
            </Text>
          </View>
        )}
      </View>
      <Text
        style={[styles.tileLabel, big ? { fontSize: 13 } : labelSize ? { fontSize: labelSize } : null, active && styles.tileLabelActive, skin?.tabIcon ? { color: active ? skin.tabIconActive ?? skin.tabIcon : skin.tabIcon } : null]}
        // Two-word names wrap onto two lines; single words share the grid's
        // size (useTileLabelSize). Fit-to-width stays as a backstop for the
        // bolder active label.
        numberOfLines={label.includes(" ") ? 2 : 1}
        adjustsFontSizeToFit
        minimumFontScale={0.87}
      >
        {label}
      </Text>
      {disabled && <Text style={styles.soon}>{soonLabel}</Text>}
    </TouchableOpacity>
  );
});

/**
 * A tile with its drag handle, memoised as a whole. Opening the menu re-rendered
 * every tile (a gesture detector, an animated style and a themed icon each) in
 * the render that starts the slide, because each got a fresh inline onPress:
 * ~150ms on a Galaxy S24+ before the sheet moved. Now only a tile whose props
 * changed renders.
 */
const MenuSlot = memo(function MenuSlot({
  id,
  ctx,
  item,
  onItemPress,
  ...tile
}: Omit<TileProps, "onPress"> & {
  id: string;
  ctx: ReorderCtx;
  item: DrawerItem;
  onItemPress: (item: DrawerItem) => void;
}) {
  const onPress = useCallback(() => onItemPress(item), [onItemPress, item]);
  return (
    <ReorderItem id={id} ctx={ctx}>
      <Tile {...tile} onPress={onPress} />
    </ReorderItem>
  );
});

/**
 * The group words beside the search button (Tabs layout). Same 12px corners
 * as the search field; a glass pill slides under the lit word.
 */
function MenuTabs({ labels, pos, onChange, square, surface, tabRefs }: {
  labels: string[];
  /** Each tab's view, so a dragged tile can be dropped on it. */
  tabRefs?: React.MutableRefObject<Array<View | null>>;
  /** The tab on show; fractional while a finger drags the pages. */
  pos: SharedValue<number>;
  onChange: (index: number) => void;
  square: boolean;
  surface: any;
}) {
  const [slots, setSlots] = useState<Array<{ x: number; w: number }>>([]);
  const [index, setIndex] = useState(0);
  useAnimatedReaction(() => Math.round(pos.value), (next, prev) => {
    if (next !== prev) runOnJS(setIndex)(next);
  });
  const pillStyle = useAnimatedStyle(() => {
    const n = slots.length;
    if (n === 0 || n < labels.length) return { opacity: 0 };
    const p = Math.max(0, Math.min(n - 1, pos.value));
    const i = Math.floor(p);
    const a = slots[i];
    const b = slots[Math.min(n - 1, i + 1)] ?? a;
    if (!a || !b) return { opacity: 0 };
    const f = p - i;
    return {
      opacity: 1,
      width: a.w + (b.w - a.w) * f,
      transform: [{ translateX: a.x + (b.x - a.x) * f }],
    };
  }, [slots, labels.length]);
  return (
    <View accessibilityRole="tablist" style={[styles.tabsBar, surface, square && styles.square]}>
      <Animated.View pointerEvents="none" style={[styles.tabsPill, square && styles.square, pillStyle]} />
      {labels.map((label, i) => (
        <TouchableOpacity
          key={i}
          ref={(el) => { if (tabRefs) tabRefs.current[i] = el as unknown as View | null; }}
          accessibilityRole="tab"
          accessibilityState={{ selected: i === index }}
          activeOpacity={0.7}
          onPress={() => onChange(i)}
          onLayout={(e) => {
            const { x: left, width } = e.nativeEvent.layout;
            setSlots((prev) => {
              if (prev[i]?.x === left && prev[i]?.w === width) return prev;
              const next = [...prev];
              next[i] = { x: left, w: width };
              return next;
            });
          }}
          style={styles.tabButton}
        >
          <Text style={[styles.tabText, i === index && styles.tabTextActive]} numberOfLines={1}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function useAllowedMenuItems() {
  const { isSignedIn } = useAuthState();
  const user = useUser();
  return useMemo(() => NAV_ITEMS.filter(
    (item) => (isSignedIn || !item.requiresAuth) && (DIGITAL_PURCHASES_ENABLED || !item.storefrontHidden)
      && (item.screen !== ScreenNames.Agents || canManageAgents(user?.walletAddress || user?.address)),
  ), [isSignedIn, user?.walletAddress, user?.address]);
}

function menuRoute(screen: string, params?: Record<string, any>, tab?: boolean) {
  return CommonActions.navigate({
    name: ScreenNames.App,
    params: tab
      ? { screen: ScreenNames.Root, params: { screen, params }, pop: true }
      : { screen, params },
  });
}

export function HomeShortcuts() {
  const pins = useNavOrder("home");
  const allowed = useAllowedMenuItems();
  const { colors } = useAppTheme();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const items = pins
    .map(id => allowed.find(item => navOrderId(item.labelKey) === id && !item.disabled))
    .filter(item => !!item);
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 4 }}>
      {items.map(item => (
        <TouchableOpacity
          key={item.labelKey}
          accessibilityRole="button"
          style={[styles.homeShortcut, { borderColor: colors.border }]}
          onPress={() => {
            if (item.url) openInApp(item.url);
            else if (item.screen) navigation.dispatch(menuRoute(item.screen, item.params, item.tab));
          }}
        >
          <Icon name={item.icon} color={colors.foreground} size={16} />
          <Text style={{ color: colors.foreground }}>{t(item.labelKey)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

interface AppDrawerProps {
  visible: boolean;
  onClose: () => void;
}

const AppDrawer: React.FC<AppDrawerProps> = ({ visible, onClose }) => {
  usePerfProbe("SideMenu");
  const navigation = useNavigation<any>();
  const { isSignedIn } = useAuthState();
  const { signOut, requireAuth } = useAuthActions();
  const user = useUser();
  const myUserId = user?.id;
  const messagesUnread = useTotalUnreadMessagesCount(myUserId) + usePublicChatUnreadCount();
  const { t } = useTranslation();
  const appTheme = useAppTheme();
  const searchField = useSearchFieldMaterial();
  const themeName: string = appTheme.theme ?? (appTheme.isMinimal ? "minimal" : "system");
  const skin = appTheme.skin ?? null;
  const androidGlass = Platform.OS === "android";
  const hud = themeName === "war";
  const square = !!skin?.square || appTheme.isMinimal;
  // A fixed draft key, not useSurfaceDraft: that reads the route context, and
  // this menu sits in the App screen, whose route object changes with every
  // nested navigation. The menu re-rendered on every tab switch and push.
  const [menuQuery, setMenuQuery] = useDraftState(MENU_QUERY_DRAFT, "");
  const [isSigningOut, setIsSigningOut] = useState(false);
  // Live size, so split-screen and unfolding resize the sheet and its
  // off-screen position instead of keeping the size from app start.
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const SHEET_HEIGHT = screenHeight * SHEET_HEIGHT_RATIO;
  const tileWidth = Math.floor((screenWidth - SHEET_BORDER_X - GRID_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);

  // Current route name, so the matching tile highlights like the web menu.
  // Tab screens live nested under Root — descend into it to find them.
  // Only while open: the menu stays mounted, and following every navigation
  // re-rendered its whole grid in the render of each tab switch and push.
  const activeRouteName = useNavigationState((state: any) => {
    if (!state || !visible) return undefined;
    const root = state.routes?.[state.index];
    const app = root?.name === ScreenNames.App ? root.state : state;
    const top = app?.routes?.[app.index ?? 0];
    if (top?.name === ScreenNames.Root) {
      const nested = top.state;
      if (nested && typeof nested.index === "number") {
        return nested.routes?.[nested.index]?.name;
      }
      return ScreenNames.Home;
    }
    return top?.name;
  });

  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);

  // The menu stays mounted while closed. Its backdrop blur lives only from
  // opening until the close slide has finished, so nothing samples the feed
  // behind a menu nobody can see.
  const [backdropLive, setBackdropLive] = useState(visible);
  useEffect(() => {
    if (visible) {
      setBackdropLive(true);
      return;
    }
    const timer = setTimeout(() => setBackdropLive(false), CLOSE_TIMING.duration + 40);
    return () => clearTimeout(timer);
  }, [visible]);
  const backdrop = useSheetBackdrop(backdropLive);
  // Where the backdrop already blurs the feed on Android, the panel takes the
  // drawers' glass wash over it instead of sampling the feed a second time
  // through its own pill material.
  const panelOverBlur = androidGlass && backdrop.blur === "android";

  useEffect(() => {
    if (!dragging.value) {
      progress.value = withTiming(visible ? 1 : 0, visible ? OPEN_TIMING : CLOSE_TIMING);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Drag-to-dismiss lives on the handle and header only, so the tile grid
  // keeps its own vertical scroll.
  const panGesture = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .failOffsetX([-20, 20])
    .onStart(() => {
      dragging.value = true;
    })
    .onUpdate((e) => {
      progress.value = Math.max(0, Math.min(1, 1 - e.translationY / SHEET_HEIGHT));
    })
    .onEnd((e) => {
      dragging.value = false;
      const shouldClose =
        e.velocityY > VELOCITY_THRESHOLD ||
        (e.velocityY >= -VELOCITY_THRESHOLD && progress.value < 1 - POSITION_THRESHOLD);

      if (shouldClose) {
        progress.value = withTiming(0, CLOSE_TIMING);
        runOnJS(onClose)();
      } else {
        progress.value = withTiming(1, OPEN_TIMING);
      }
    })
    .onFinalize(() => {
      // A cancelled gesture must not leave the next open/close animation locked.
      if (dragging.value) {
        dragging.value = false;
        progress.value = withTiming(visible ? 1 : 0, visible ? OPEN_TIMING : CLOSE_TIMING);
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [SHEET_HEIGHT, 0]) },
    ],
  }));

  const navigate = useCallback(
    (screen: string, params?: Record<string, any>, tab?: boolean) => {
      onClose();
      Keyboard.dismiss();
      // This sheet is a sibling of AppNavigator's stack, so useNavigation
      // belongs to the outer App screen. Actions cannot navigate down into
      // that stack implicitly: include App, and Root for bottom-tab routes.
      // pop sits next to Root, not in the tab params: the menu also opens
      // from Profile, and there the App stack must go back to the Root
      // underneath instead of pushing a second one.
      navigation.dispatch(menuRoute(screen, params, tab));
    },
    [navigation, onClose],
  );
  // The Followers / Following counts open the same lists as on the profile.
  const openFollowList = useCallback((tab: "followers" | "following") => {
    const address = ((user as any)?.walletAddress || (user as any)?.address || "") as string;
    if (!address) return;
    navigate(ScreenNames.FollowList, {
      address,
      username: (user as any)?.username,
      initialTab: tab,
      hideFollowers: (user as any)?.hideFollowers,
      isOwnProfile: true,
    });
  }, [navigate, user]);


  // Menu search (libs/navSearch, same matching as the web menu): the row's
  // name in the reader's language and in English, its search words ("build"
  // finds Requests) in English and translated, plurals and small typos. Rows
  // marked searchOnly only appear once something is typed.
  const allowedItems = useAllowedMenuItems();
  const visibleItems = useMemo(
    () => filterNavRows(allowedItems, menuQuery, (key, defaultValue) => t(key, defaultValue)),
    [allowedItems, menuQuery, t],
  );

  const searching = menuQuery.trim().length > 0;

  // Groups (libs/menuGroups) in the layout picked in Settings (libs/menuLayout):
  // Tabs (default) shows one group at a time, Sections every group under a
  // header, Folders the Main group and then a folder per other group.
  const menuLayout = useAppPrefs().menuLayout;
  const restingItems = useMemo(
    () => filterNavRows(allowedItems, "", (key, defaultValue) => t(key, defaultValue)),
    [allowedItems, t],
  );
  const groupMoves = useMenuGroupMoves();
  const menuGroups = useMemo(() => groupMenuItems(restingItems, groupMoves, navOrderId), [restingItems, groupMoves]);
  const grouped = menuGroups.length > 1;
  const [menuTab, setMenuTab] = useState(0);
  const tabIndex = Math.min(menuTab, Math.max(0, menuGroups.length - 1));
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  // Tabs: search is a button beside the group words until tapped, then that
  // row is the search field (X turns it back).
  const tabsHeader = grouped && menuLayout === "tabs";
  const [searchOpen, setSearchOpen] = useState(false);
  const bigTiles = grouped && menuLayout !== "sections";
  const bigTileWidth = Math.floor((screenWidth - SHEET_BORDER_X - GRID_PADDING * 2 - GRID_GAP * (BIG_COLUMNS - 1)) / BIG_COLUMNS);
  // The open folder's panel has its own 12px padding and 1px border each side.
  const panelTileWidth = Math.floor((screenWidth - SHEET_BORDER_X - GRID_PADDING * 2 - 26 - GRID_GAP * (BIG_COLUMNS - 1)) / BIG_COLUMNS);
  // Rows a drag can rearrange: the tab on show, or Folders' Main grid. The
  // Sections layout is several grids, so it holds still.
  const reorderPool = useMemo(() => {
    if (searching || !grouped) return visibleItems;
    if (menuLayout === "tabs") return menuGroups[tabIndex]?.items ?? [];
    if (menuLayout === "folders") return menuGroups[0]?.items ?? [];
    return [];
  }, [searching, grouped, visibleItems, menuLayout, menuGroups, tabIndex]);
  // Sized from the resting grid's names, so a search does not resize the tiles.
  const gridLabels = useMemo(() => NAV_ITEMS.filter((item) => !item.searchOnly).map((item) => t(item.labelKey)), [t]);
  const tileLabel = useTileLabelSize(gridLabels, tileWidth);

  // Hold a tile and drag it to rearrange; saved per account (this device when
  // signed out) and shared with the web menu. Off while searching: results are
  // ordered by match, not by the person's order.
  const savedMenuOrder = useNavOrder("menu");
  const menuWallet = ((user as any)?.walletAddress || (user as any)?.address || "").toLowerCase() || null;
  const orderedItems = useMemo(
    () => (searching ? reorderPool : applyNavOrder(reorderPool, savedMenuOrder, (item) => navOrderId(item.labelKey))),
    [searching, reorderPool, savedMenuOrder],
  );
  const itemsById = useMemo(() => new Map(orderedItems.map((item) => [navOrderId(item.labelKey), item])), [orderedItems]);
  const orderedIds = useMemo(() => orderedItems.map((item) => navOrderId(item.labelKey)), [orderedItems]);
  const commitMenuOrder = useCallback(
    (next: string[]) => saveNavOrder("menu", next, DEFAULT_MENU_IDS, isSignedIn ? menuWallet : null),
    [isSignedIn, menuWallet],
  );
  const reorderOff = searching || (grouped && menuLayout === "sections");
  const pins = useNavOrder("home");
  const target = useRef<View>(null);
  const targetBounds = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // Tab buttons in window coordinates, measured when a drag starts: dropping a
  // tile on another tab moves it to that group (libs/menuGroupMoves).
  const tabBounds = useRef<Array<{ x: number; y: number; w: number; h: number } | null>>([]);
  const tabRefs = useRef<Array<View | null>>([]);
  const onDropOutside = (id: string, x: number, y: number) => {
    if (tabsHeader && !searching) {
      const hit = tabBounds.current.findIndex((b) => !!b && x >= b.x && x <= b.x + b.w && y >= b.y - 8 && y <= b.y + b.h + 8);
      const group = hit >= 0 ? menuGroups[hit] : undefined;
      const item = itemsById.get(id);
      if (group && item) {
        return moveMenuTile(id, group.id, defaultMenuGroupOf(item.labelKey), isSignedIn ? menuWallet : null);
      }
    }
    const r = targetBounds.current;
    if (!r || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return false;
    toggleHomeShortcut(id, menuWallet);
    return true;
  };
  const menuReorder = useReorder({ ids: orderedIds, onCommit: commitMenuOrder, disabled: reorderOff, onDropOutside });
  useEffect(() => {
    if (!menuReorder.draggingId) return;
    tabRefs.current.forEach((ref, i) => {
      ref?.measureInWindow((x, y, w, h) => { tabBounds.current[i] = { x, y, w, h }; });
    });
  }, [menuReorder.draggingId]);
  const sortGroup = useCallback(
    (group: MenuGroup<DrawerItem>) => applyNavOrder(group.items, savedMenuOrder, (item) => navOrderId(item.labelKey)),
    [savedMenuOrder],
  );

  // Never reopen the sheet mid-filter, and always on the first group.
  useEffect(() => {
    if (!visible) {
      setMenuQuery.initialize("");
      setSearchOpen(false);
      setMenuTab(0);
      setOpenFolder(null);
    }
  }, [visible, setMenuQuery]);
  const closeSearch = useCallback(() => {
    setMenuQuery.complete(menuQuery, "");
    setSearchOpen(false);
  }, [menuQuery, setMenuQuery]);
  // Tabs: the groups sit side by side and a sideways drag moves them under the
  // finger; tabPos is the group on show, fractional mid-drag, and the tab
  // pill reads it too.
  const tabCount = menuGroups.length;
  const tabPos = useSharedValue(0);
  const swipeFrom = useSharedValue(0);
  const tabPageWidth = screenWidth - SHEET_BORDER_X;
  useEffect(() => {
    tabPos.value = visible ? withTiming(tabIndex, TAB_TIMING) : tabIndex;
  }, [tabIndex, visible, tabPos]);
  const tabSwipe = Gesture.Pan()
    .enabled(tabsHeader && !searching && !menuReorder.draggingId && tabCount > 1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onStart(() => {
      swipeFrom.value = Math.round(tabPos.value);
    })
    .onUpdate((e) => {
      const last = tabCount - 1;
      let p = swipeFrom.value - e.translationX / tabPageWidth;
      // Past the first or last group the row only gives a little.
      if (p < 0) p /= 3;
      else if (p > last) p = last + (p - last) / 3;
      tabPos.value = p;
    })
    .onEnd((e) => {
      const from = swipeFrom.value;
      const moved = tabPos.value - from;
      let next = from;
      if (Math.abs(e.velocityX) > 400 && Math.abs(e.translationX) > 20) next = from + (e.velocityX < 0 ? 1 : -1);
      else if (Math.abs(moved) > 0.3) next = from + (moved > 0 ? 1 : -1);
      next = Math.max(0, Math.min(tabCount - 1, next));
      tabPos.value = withTiming(next, TAB_TIMING);
      if (next !== from) runOnJS(setMenuTab)(next);
    });
  const tabStripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -tabPos.value * tabPageWidth }],
  }), [tabPageWidth]);
  // An opened folder's panel lands under the folders, often below the fold.
  useEffect(() => {
    if (!openFolder) return;
    const id = setTimeout(() => (menuReorder.scrollRef?.current as any)?.scrollToEnd?.({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [openFolder, menuReorder.scrollRef]);

  // The closed menu stays mounted, so on Android its search field was the
  // first focusable box left on Home once another screen's focused field went
  // away (the post composer closing): it took focus off-screen and held the
  // keyboard up over the feed. Closed, it cannot be focused at all.
  const searchRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!visible) searchRef.current?.blur();
  }, [visible]);
  const { onFocus: onSearchFieldFocus } = searchField;
  const onSearchFocus = useCallback(() => {
    if (!visible) {
      searchRef.current?.blur();
      Keyboard.dismiss();
      return;
    }
    onSearchFieldFocus();
  }, [visible, onSearchFieldFocus]);

  // The escape hatch: run whatever was typed as a real search instead. `ts`
  // is a nonce — without it a repeat of the same term produces identical route
  // params, and the Explore screen has no change to react to.
  const runFullSearch = useCallback(() => {
    const query = menuQuery.trim();
    if (!query) return;
    setMenuQuery.complete(menuQuery, "");
    navigate(ScreenNames.Explore, { q: query, ts: Date.now() }, true);
  }, [menuQuery, navigate, setMenuQuery]);

  const handleItemPress = useCallback(
    (item: DrawerItem) => {
      // The release of a drag is not a tap.
      if (justDropped()) return;
      if (item.disabled) {
        toastInfo(item.disabledMessage ?? t("screens.comingSoon"));
        return;
      }
      if (item.url) {
        onClose();
        openInApp(item.url);
      } else if (item.screen) {
        navigate(item.screen, item.params, item.tab);
      }
    },
    [navigate, onClose, t],
  );

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    onClose();
    try {
      await signOut();
    } catch (error) {
      toastError(error, t("settings.logoutFailed"));
    } finally {
      setIsSigningOut(false);
    }
  }, [isSigningOut, onClose, signOut, t]);

  const handlePost = useCallback(() => {
    navigate(activeRouteName?.startsWith('Work') ? ScreenNames.WorkPost : ScreenNames.Upload);
  }, [activeRouteName, navigate]);

  const handleSignIn = useCallback(() => {
    // The same sign-in sheet as a signed-out like or follow.
    onClose();
    requireAuth(() => {});
  }, [onClose, requireAuth]);

  const displayName = user?.displayName || user?.username || t("common.anonymous");
  const handle = user?.username ? `@${user.username}` : "";
  const avatarUrl = user?.avatarImageUrl ? getAvatarUrl(user.avatarImageUrl) : undefined;
  // Same badge as beside the name on your posts and comments.
  const badgeImg = useMemo(() => getBadgeUrlFor(user as any), [user]);
  // The DHB the wallet actually holds; badgeBalance can include delegation.
  const dhbBalance = Math.floor(user?.ownBadgeBalance ?? user?.badgeBalance ?? 0);
  const balanceHidden = useBalanceHidden();

  const renderItem = (item: DrawerItem, big = false) => {
    const key = ICON_KEYS[item.labelKey];
    const id = navOrderId(item.labelKey);
    return (
      <MenuSlot
        key={item.labelKey}
        id={id}
        ctx={menuReorder.ctx}
        item={item}
        onItemPress={handleItemPress}
        big={big}
        label={t(item.labelKey)}
        labelSize={tileLabel.size}
        icon={item.icon}
        iconUrl={key ? themeIconUrl(themeName, key) : undefined}
        iconColor={['hacker', 'island', 'horror'].includes(themeName) ? appTheme.colors.accent : undefined}
        width={big ? bigTileWidth : tileWidth}
        active={!!item.screen && item.screen === activeRouteName && !item.params}
        badgeCount={
          !isSignedIn ? 0
            : item.screen === ScreenNames.DM ? messagesUnread
              : item.screen === ScreenNames.Notifications ? user?.notificationCount ?? 0
                : 0
        }
        lifted={menuReorder.draggingId === id}
        disabled={item.disabled}
        soonLabel={t("screens.soon")}
        skin={skin}
        hud={hud}
        square={square}
      />
    );
  };

  // A tile outside the drag grid (Sections, an open folder): same look, no handle.
  const renderPlain = (item: DrawerItem, width: number, big: boolean) => {
    const key = ICON_KEYS[item.labelKey];
    return (
      <Tile
        key={item.labelKey}
        big={big}
        label={t(item.labelKey)}
        labelSize={tileLabel.size}
        icon={item.icon}
        iconUrl={key ? themeIconUrl(themeName, key) : undefined}
        iconColor={['hacker', 'island', 'horror'].includes(themeName) ? appTheme.colors.accent : undefined}
        width={width}
        active={!!item.screen && item.screen === activeRouteName && !item.params}
        badgeCount={
          !isSignedIn ? 0
            : item.screen === ScreenNames.DM ? messagesUnread
              : item.screen === ScreenNames.Notifications ? user?.notificationCount ?? 0
                : 0
        }
        disabled={item.disabled}
        soonLabel={t("screens.soon")}
        skin={skin}
        hud={hud}
        square={square}
        onPress={() => handleItemPress(item)}
        onLongPress={() => {
          const id = navOrderId(item.labelKey);
          const action = t(pins.includes(id) ? "communities.unpin" : "communities.pin") + " · " + t("nav.home");
          Alert.alert(t(item.labelKey), undefined, [
            { text: t("common.cancel"), style: "cancel" },
            { text: action, onPress: () => toggleHomeShortcut(id, menuWallet) },
          ]);
        }}
      />
    );
  };

  const hairline = skin?.card?.borderColor ?? "rgba(255, 255, 255, 0.10)";
  const dragGrid = (big: boolean) => (
    <View style={styles.grid}>
      {menuReorder.order.map((id) => itemsById.get(id)).filter((item): item is DrawerItem => !!item).map((item) => renderItem(item, big))}
    </View>
  );
  const reorderHint = (
    <View style={styles.reorderHint}>
      <Text style={styles.reorderHintText}>
        {tabsHeader
          ? t("nav.reorderHintGroups", { defaultValue: "Hold and drag any icon to rearrange, or onto another tab to move it" })
          : t("nav.reorderHint", { defaultValue: "Hold and drag any icon to rearrange" })}
      </Text>
      {(savedMenuOrder.length > 0 || Object.keys(groupMoves).length > 0) && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => menuReorder.animateChange(
            () => {
              resetNavOrder("menu", isSignedIn ? menuWallet : null);
              // Reset also puts every tile back in its own group.
              if (Object.keys(groupMoves).length) saveMenuGroupMoves({}, isSignedIn ? menuWallet : null);
            },
            reorderPool.map((item) => navOrderId(item.labelKey)),
          )}
          hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}
        >
          <Text style={styles.reorderReset}>{t("nav.reorderReset", { defaultValue: "Reset" })}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
  // Every tab as tall as the longest, so the sheet holds still between them.
  const longestGroup = Math.max(0, ...menuGroups.map((group) => group.items.length));
  const tabRows = Math.ceil(longestGroup / BIG_COLUMNS);
  const tabsMinHeight = tabRows * BIG_TILE_HEIGHT + Math.max(0, tabRows - 1) * GRID_GAP;

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 999 }]}
      pointerEvents={visible ? "auto" : "none"}
    >
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel={t("common.close")}
          style={[StyleSheet.absoluteFill, { backgroundColor: "transparent" }]}
        >
          <SheetBackdrop backdrop={backdrop} />
        </TouchableOpacity>
      </Animated.View>

      <View ref={target} collapsable={false} pointerEvents="none"
        onLayout={() => target.current?.measureInWindow((x, y, w, h) => { targetBounds.current = { x, y, w, h }; })}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: SHEET_HEIGHT, alignItems: "center", justifyContent: "flex-end", paddingBottom: 8 }}>
        {menuReorder.draggingId && (
          <Text style={{ color: appTheme.colors.foreground, backgroundColor: appTheme.colors.background, borderRadius: 18, overflow: "hidden", paddingHorizontal: 16, paddingVertical: 8, fontWeight: "600" }}>
            {t(pins.includes(menuReorder.draggingId) ? "communities.unpin" : "communities.pin")} · {t("nav.home")}
          </Text>
        )}
        {menuReorder.draggingId && tabsHeader && (
          <Text style={{ marginTop: 8, color: appTheme.colors.foreground, backgroundColor: appTheme.colors.background, borderRadius: 18, overflow: "hidden", paddingHorizontal: 14, paddingVertical: 6, fontSize: 13, fontWeight: "600" }}>
            {t("nav.moveGroupHint", { defaultValue: "Drop on another tab to move it there" })}
          </Text>
        )}
      </View>
      <Animated.View
        testID="app-menu-sheet"
        style={[
          styles.sheet,
          {
            height: SHEET_HEIGHT,
            backgroundColor: androidGlass ? "transparent" : skin?.page ?? "#0B0B0E",
            borderColor: hairline,
            elevation: androidGlass ? 0 : 12,
          },
          square && styles.square,
          sheetStyle,
        ]}
      >
        {panelOverBlur ? (
          <SheetGlassFill backdropBlurred style={[StyleSheet.absoluteFill, { backgroundColor: SHEET_GLASS_FILL }]} />
        ) : androidGlass ? (
          // Live only while the menu is up. Closed, this fallback used to
          // keep a blur sampling the feed for a menu nobody can see, and it
          // re-attached each time the feed came back from under a profile,
          // blanking the feed for a frame or two.
          <FrostedPill tint={glassTint(skin?.page ?? "#0B0B0E", 0.18)} borderRadius={0} live={backdropLive} />
        ) : null}
        {/* Jungle's plank grain and War's HUD corners, as on the feed chrome. */}
        {!androidGlass && skin?.grain ? (
          <RNImage source={GRAIN} resizeMode="repeat" style={StyleSheet.absoluteFill} />
        ) : null}
        {skin?.brackets ? <HudBrackets color={skin.brackets} length={18} /> : null}
        {/* Android samples the shared blur target beneath this sheet. The
            sheet clips the glass to its top corners without an outer shadow. */}
        <GestureDetector gesture={panGesture}>
          <View>
            <View style={styles.handleZone}>
              <View style={styles.handle} />
            </View>

            {isSignedIn && user ? (
              <View style={styles.header}>
                <TouchableOpacity
                  style={styles.headerIdentity}
                  onPress={() => navigate(ScreenNames.Profile)}
                  activeOpacity={0.7}
                >
                  <Avatar uri={avatarUrl} size={44} name={displayName || handle} />
                  <View style={styles.headerText}>
                    <View style={styles.headerNameRow}>
                      <Text style={[styles.headerName, styles.headerNameText]} numberOfLines={1}>{displayName}</Text>
                      {badgeImg && (
                        <BadgeArtwork
                          source={badgeImg}
                          style={[getBadgeOpticalStyle(badgeImg, 16, 0, 20), { marginLeft: 2 }]}
                          contentFit="contain"
                        />
                      )}
                    </View>
                    {typeof user.followers === "number" || typeof user.followings === "number" ? (
                      <View style={styles.headerCounts} testID="drawer-follow-counts">
                        <TouchableOpacity
                          style={styles.headerCount}
                          onPress={() => openFollowList("followers")}
                          activeOpacity={0.6}
                          hitSlop={{ top: 8, bottom: 8 }}
                          accessibilityRole="button"
                          testID="drawer-followers"
                        >
                          <Text style={styles.headerCountText} numberOfLines={1}>
                            <Text style={styles.headerCountNumber}>{formatCompactNumber(user.followers ?? 0)}</Text> {t("profile.followers")}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.headerCount}
                          onPress={() => openFollowList("following")}
                          activeOpacity={0.6}
                          hitSlop={{ top: 8, bottom: 8 }}
                          accessibilityRole="button"
                          testID="drawer-following"
                        >
                          <Text style={styles.headerCountText} numberOfLines={1}>
                            <Text style={styles.headerCountNumber}>{formatCompactNumber(user.followings ?? 0)}</Text> {t("profile.following")}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : handle ? <Text style={styles.headerHandle} numberOfLines={1}>{handle}</Text> : null}
                  </View>
                </TouchableOpacity>
                {DIGITAL_PURCHASES_ENABLED && dhbBalance > 0 && (
                  <View style={[styles.balanceChip, square && styles.square]}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={balanceHidden ? t("nav.wallet") : `${t("nav.wallet")} ${dhbBalance.toLocaleString()}`}
                      onPress={() => navigate(ScreenNames.Dpay, { initialTab: "wallet" })}
                      activeOpacity={0.7}
                      style={styles.balanceMain}
                    >
                      <DhbCoin size={16} />
                      {/* Compact from 10k up, so the chip never squeezes the counts line (Requests eaf824e2). */}
                      <Text style={styles.balanceText}>{balanceHidden ? HIDDEN_BALANCE : dhbBalance >= 10_000 ? formatCompactNumber(dhbBalance) : dhbBalance.toLocaleString()}</Text>
                    </TouchableOpacity>
                    {/* Eye: hide or show the number on this device (Requests 4c8cc200). */}
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={balanceHidden ? t("wallet.showBalance", { defaultValue: "Show balance" }) : t("wallet.hideBalance", { defaultValue: "Hide balance" })}
                      accessibilityState={{ selected: balanceHidden }}
                      onPress={() => setBalanceHidden(!balanceHidden)}
                      activeOpacity={0.6}
                      hitSlop={{ top: 8, bottom: 8, right: 6 }}
                      style={styles.balanceEye}
                      testID="drawer-balance-eye"
                    >
                      {/* Plain white so it follows the number's colour in every theme (System Light turns it dark); dimmed a touch (Requests 70b20f3f). */}
                      <View style={styles.balanceEyeIcon}>
                        <Icon name={balanceHidden ? "EyeOff" : "Eye"} size={15} color="#FFFFFF" />
                      </View>
                    </TouchableOpacity>
                  </View>
                )}
                <MenuAccountSwitcher
                  avatarUrl={avatarUrl}
                  name={displayName || handle}
                  activeAddress={user.walletAddress || user.address}
                  ringColor={skin?.page ?? "#0B0B0E"}
                  square={square}
                  onPicked={onClose}
                />
              </View>
            ) : (
              <View style={styles.header}>
                <TouchableOpacity style={styles.headerIdentity} onPress={handleSignIn} activeOpacity={0.7}>
                  <View style={[styles.signInIcon, square && styles.square]}>
                    <Icon name="User" size={22} color="#9CA3AF" />
                  </View>
                  <View style={styles.headerText}>
                    <Text style={styles.headerName}>{t("screens.signIn")}</Text>
                    <Text style={styles.headerHandle}>{t("screens.tapToGetStarted")}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {/* Menu search. Filters the tiles below; anything that is not a
                page is one tap away via the hand-off, which runs the query on
                the Explore tab. */}
            {tabsHeader && !searchOpen && !menuQuery ? (
              <View style={styles.tabsRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t("sidebar.searchMenu")}
                  onPress={() => setSearchOpen(true)}
                  activeOpacity={0.7}
                  style={[styles.searchButton, square && styles.square, searchField.surface]}
                >
                  <Icon name="Search" size={18} color="#D4D4D8" />
                </TouchableOpacity>
                <MenuTabs
                  tabRefs={tabRefs}
                  labels={menuGroups.map((group) => t(group.labelKey, group.fallback))}
                  pos={tabPos}
                  onChange={setMenuTab}
                  square={square}
                  surface={searchField.surface}
                />
              </View>
            ) : (
            <View style={[styles.searchWrap, square && styles.square, searchField.surface]}>
              <Icon name="Search" size={16} color="#808089" />
              <TextInput
                ref={searchRef}
                editable={visible}
                value={menuQuery}
                onChangeText={setMenuQuery}
                placeholder={t("sidebar.searchMenu")}
                placeholderTextColor="#808089"
                style={[styles.searchInput, SEARCH_INPUT_CLEAR]}
                onFocus={onSearchFocus}
                onBlur={searchField.onBlur}
                returnKeyType="search"
                onSubmitEditing={runFullSearch}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel={t("sidebar.searchMenu")}
                autoFocus={tabsHeader && searchOpen}
              />
              {(menuQuery.length > 0 || (tabsHeader && searchOpen)) && (
                <TouchableOpacity
                  onPress={closeSearch}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={t("sidebar.clearSearch")}
                >
                  <Icon name="X" size={15} color="#A1A1AA" />
                </TouchableOpacity>
              )}
            </View>
            )}
          </View>
        </GestureDetector>

        <Animated.ScrollView
          ref={menuReorder.scrollRef}
          onLayout={menuReorder.onViewportLayout}
          scrollEnabled={!menuReorder.draggingId}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          bounces={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: 16 }}
        >
          {tileLabel.measurer}
          {searching || !grouped ? (
            <>
              {/* Search results, ranked: one grid whatever the layout. */}
              {orderedItems.length > 0 && dragGrid(bigTiles)}
              {!searching && reorderHint}
            </>
          ) : menuLayout === "sections" ? (
            menuGroups.map((group, i) => (
              <View key={group.id}>
                <View style={[styles.sectionHead, i === 0 && { marginTop: 2 }]}>
                  <Text style={styles.sectionTitle}>{t(group.labelKey, group.fallback)}</Text>
                  <Text style={styles.sectionCount}>{group.items.length}</Text>
                </View>
                <View style={styles.grid}>{sortGroup(group).map((item) => renderPlain(item, tileWidth, false))}</View>
              </View>
            ))
          ) : menuLayout === "folders" ? (
            <>
              {dragGrid(true)}
              <View style={[styles.grid, { marginTop: GRID_GAP }]}>
                {menuGroups.slice(1).map((group) => {
                  const isOpen = openFolder === group.id;
                  return (
                    <TouchableOpacity
                      key={group.id}
                      accessibilityRole="button"
                      accessibilityLabel={t(group.labelKey, group.fallback)}
                      accessibilityState={{ expanded: isOpen }}
                      activeOpacity={0.7}
                      onPress={() => setOpenFolder(isOpen ? null : group.id)}
                      style={[
                        styles.tile,
                        styles.folderTile,
                        { width: tileWidth },
                        Platform.OS === "android" ? skin?.strip : skin?.card,
                        isOpen && styles.tileActive,
                        isOpen && skin?.stripActive,
                        square && styles.square,
                      ]}
                    >
                      <View style={[styles.folderIcons, square && styles.square]}>
                        {group.items.slice(0, 4).map((item) => {
                          const key = ICON_KEYS[item.labelKey];
                          return key
                            ? <Image key={item.labelKey} source={{ uri: themeIconUrl(themeName, key) }} style={styles.folderIcon} contentFit="contain" cachePolicy="disk" />
                            : <Icon key={item.labelKey} name={item.icon} size={16} color="#D4D4D8" />;
                        })}
                      </View>
                      <Text style={styles.folderName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t(group.labelKey, group.fallback)}</Text>
                      <Text style={styles.folderCount}>{group.items.length}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {(() => {
                const open = menuGroups.find((group) => group.id === openFolder);
                if (!open) return null;
                return (
                  <View style={[styles.folderPanel, square && styles.square, { borderColor: hairline }]}>
                    <Text style={styles.folderPanelTitle}>{t(open.labelKey, open.fallback)}</Text>
                    <View style={styles.grid}>{sortGroup(open).map((item) => renderPlain(item, panelTileWidth, true))}</View>
                  </View>
                );
              })()}
              {reorderHint}
            </>
          ) : (
            <>
              {/* Tabs: the groups side by side; a sideways drag moves them. */}
              <GestureDetector gesture={tabSwipe}>
                <View style={{ minHeight: tabsMinHeight, marginHorizontal: -GRID_PADDING, overflow: "hidden" }}>
                  <Animated.View style={[{ flexDirection: "row", width: tabPageWidth * tabCount }, tabStripStyle]}>
                    {menuGroups.map((group, i) => {
                      const current = i === tabIndex;
                      return (
                        <View
                          key={group.id}
                          style={{ width: tabPageWidth, paddingHorizontal: GRID_PADDING }}
                          accessibilityElementsHidden={!current}
                          importantForAccessibility={current ? "auto" : "no-hide-descendants"}
                          pointerEvents={current ? "auto" : "none"}
                        >
                          {current
                            ? dragGrid(true)
                            // Every group stays drawn (a handful of tiles each), so a
                            // tab change never builds a page or reloads its art mid-swipe.
                            : (
                              <View style={styles.grid}>{sortGroup(group).map((item) => renderPlain(item, bigTileWidth, true))}</View>
                            )}
                        </View>
                      );
                    })}
                  </Animated.View>
                </View>
              </GestureDetector>
              <View style={styles.dots}>
                {menuGroups.map((group, i) => (
                  <View key={group.id} style={[styles.dot, i === tabIndex && styles.dotOn]} />
                ))}
              </View>
              {reorderHint}
            </>
          )}

          {searching && (
            <>
              {visibleItems.length === 0 && (
                menuQuery.trim().length >= 2 ? (
                  <View style={{ marginTop: 4, marginBottom: 8 }}>
                    <SearchRequestPrompt query={menuQuery} source="menu" onOpenRequests={() => navigate(ScreenNames.FeatureRequests)} />
                  </View>
                ) : (
                  <Text style={styles.noMatches}>{t("sidebar.noMenuMatches")}</Text>
                )
              )}
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.6}
                onPress={runFullSearch}
                style={[styles.handoff, { borderTopColor: hairline }]}
              >
                <Icon name="Search" size={18} color="#A1A1AA" strokeWidth={1.8} />
                <Text style={styles.handoffText} numberOfLines={1}>
                  {t("sidebar.searchDehubFor", { query: menuQuery.trim() })}
                </Text>
                <Icon name="ChevronRight" size={16} color="#808089" />
              </TouchableOpacity>
            </>
          )}
        </Animated.ScrollView>

        {isSignedIn && (
          <View style={[styles.footer, { borderTopColor: hairline }]}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.logOut")}
              activeOpacity={0.6}
              disabled={isSigningOut}
              onPress={handleSignOut}
              style={[styles.logoutButton, isSigningOut && styles.logoutButtonDisabled]}
            >
              <Icon name="LogOut" size={20} color="#A1A1AA" strokeWidth={1.8} />
              <Text style={styles.logoutLabel}>{t("sidebar.logOut")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("sidebar.post")}
              activeOpacity={0.7}
              onPress={handlePost}
              style={styles.postButton}
            >
              <Icon name="SquarePen" size={20} color="#FFFFFF" strokeWidth={2} />
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  homeShortcut: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 8,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    zIndex: 999,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
  },
  square: {
    borderRadius: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  handleZone: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.28)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: GRID_PADDING,
    marginBottom: 14,
    gap: 12,
  },
  headerIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerName: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  headerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  headerNameText: {
    flexShrink: 1,
    minWidth: 0,
  },
  headerHandle: {
    color: "#A1A1AA",
    fontSize: 13,
    marginTop: 1,
  },
  // Wraps rather than squeezing: on a narrow phone Following drops to its own
  // line next to the balance chip (Requests eaf824e2).
  headerCounts: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 12,
    marginTop: 3,
    minWidth: 0,
  },
  headerCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  headerCountText: {
    color: "#A1A1AA",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  headerCountNumber: {
    color: "#E4E4E7",
    fontWeight: "700",
  },
  signInIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.10)",
  },
  balanceChip: {
    flexDirection: "row",
    alignItems: "center",
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  balanceMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: "100%",
    paddingLeft: 12,
    paddingRight: 6,
  },
  balanceEye: {
    height: "100%",
    justifyContent: "center",
    paddingLeft: 2,
    paddingRight: 10,
  },
  balanceEyeIcon: {
    opacity: 0.8,
  },
  balanceText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    height: 42,
    marginHorizontal: GRID_PADDING,
    marginBottom: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  searchInput: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15,
    // Android's TextInput carries its own vertical padding, which pushes the
    // text off-centre inside a fixed-height row.
    paddingVertical: 0,
  },
  tabsRow: {
    flexDirection: "row",
    gap: 6,
    height: 42,
    marginHorizontal: GRID_PADDING,
    marginBottom: 14,
  },
  searchButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  tabsBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    padding: 3,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  tabsPill: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 0,
    borderRadius: 9,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.28)",
  },
  tabButton: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  tabText: {
    color: "#A1A1AA",
    fontSize: 13,
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#A1A1AA",
    opacity: 0.35,
  },
  dotOn: {
    width: 18,
    opacity: 0.9,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 2,
  },
  sectionTitle: {
    color: "#E4E4E7",
    fontSize: 12.5,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionCount: {
    color: "#71717A",
    fontSize: 12,
  },
  folderTile: {
    minHeight: 96,
    gap: 5,
    paddingVertical: 9,
  },
  folderIcons: {
    width: 50,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
    padding: 4,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  folderIcon: {
    width: 19,
    height: 19,
  },
  folderName: {
    color: "#F4F4F5",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    alignSelf: "stretch",
  },
  folderCount: {
    color: "#71717A",
    fontSize: 10.5,
    marginTop: -3,
  },
  folderPanel: {
    marginTop: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  folderPanelTitle: {
    color: "#F4F4F5",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 10,
    marginHorizontal: 2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  tileLifted: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderColor: "rgba(255, 255, 255, 0.30)",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  reorderHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 8,
  },
  reorderHintText: {
    color: "#71717A",
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
  reorderReset: {
    color: "#D4D4D8",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
  },
  tile: {
    alignItems: "center",
    // Top-aligned so icons stay in line across a row where one name wraps.
    justifyContent: "flex-start",
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 10,
    minHeight: 84,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  tileBig: {
    gap: 8,
    paddingTop: 13,
    paddingBottom: 11,
    minHeight: BIG_TILE_HEIGHT,
  },
  tileIconBig: {
    width: BIG_ICON_SIZE,
    height: BIG_ICON_SIZE,
  },
  tileActive: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderColor: "rgba(255, 255, 255, 0.24)",
  },
  tileIcon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  tileImage: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  labelMeasure: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 10000,
    alignItems: "flex-start",
    opacity: 0,
  },
  labelMeasureText: {
    alignSelf: "flex-start",
  },
  tileLabel: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 11.5,
    fontWeight: "500",
    textAlign: "center",
    alignSelf: "stretch",
  },
  tileLabelActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  soon: {
    color: "#A1A1AA",
    fontSize: 10,
    fontWeight: "500",
  },
  noMatches: {
    color: "#71717A",
    fontSize: 14,
    paddingVertical: 12,
  },
  handoff: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderTopWidth: 1,
  },
  handoffText: {
    flex: 1,
    color: "#A1A1AA",
    fontSize: 15,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
  },
  logoutButton: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  postButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutButtonDisabled: {
    opacity: 0.5,
  },
  logoutLabel: {
    color: "#A1A1AA",
    fontSize: 15,
    fontWeight: "500",
  },
});

export default memo(AppDrawer, perfPropsEqual("SideMenu"));
