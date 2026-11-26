/**
 * Our pages as things you can link to
 * ===================================
 * Each page's riftn.com address with the menu's own name and icon for it.
 * Two surfaces read this:
 *
 * - the @ list, which offers pages beside people and communities and types
 *   the page's riftn.com link into the message;
 * - the page card (DehubLinkCard), which shows a riftn.com link to one of
 *   these as the page's name and icon, and opens its screen on tap.
 *
 * Labels are the menu sheet's keys (components/Home/AppDrawer), so search
 * goes through the same matching as the menu (libs/navSearch) and every
 * language the menu speaks.
 */
import type { IconName } from '../components/ui/Icon';
import { appPageParent } from './app-page-paths';

export interface LinkablePage {
  /** riftn.com path, as the web routes it. */
  path: string;
  labelKey: string;
  icon: IconName;
  /** Kept out of the App Store build's menu; never offered there either. */
  storefrontHidden?: boolean;
}

export const LINKABLE_PAGES: LinkablePage[] = [
  { path: '/app/explore', labelKey: 'nav.explore', icon: 'Search' },
  { path: '/shorts', labelKey: 'feed.shorts', icon: 'Film' },
  { path: '/videos', labelKey: 'feed.videos', icon: 'Video' },
  { path: '/music', labelKey: 'feed.music', icon: 'Music' },
  { path: '/app/communities', labelKey: 'nav.communities', icon: 'Users' },
  { path: '/app/leaderboard', labelKey: 'nav.leaderboard', icon: 'Trophy' },
  { path: '/build', labelKey: 'nav.featureRequests', icon: 'Lightbulb' },
  { path: '/feedback', labelKey: 'stats.feedback.title', icon: 'MessageSquare' },
  { path: '/app/events', labelKey: 'nav.events', icon: 'CalendarDays' },
  { path: '/stages', labelKey: 'nav.stages', icon: 'Mic' },
  { path: '/arcade', labelKey: 'nav.arcade', icon: 'Gamepad2' },
  { path: '/app/assistant', labelKey: 'nav.assistant', icon: 'Sparkles' },
  { path: '/prompt', labelKey: 'nav.prompt', icon: 'Wand' },
  { path: '/editor', labelKey: 'creator.editor', icon: 'Film' },
  { path: '/creator', labelKey: 'commandCentre.creator', icon: 'Creator' },
  { path: '/creators', labelKey: 'nav.creators', icon: 'Star' },
  { path: '/stats', labelKey: 'nav.stats', icon: 'ChartColumn' },
  { path: '/packs', labelKey: 'creatorPacks.title', icon: 'Smile' },
  { path: '/app/top-100', labelKey: 'top100.title', icon: 'Trophy' },
  { path: '/chat', labelKey: 'publicChat.title', icon: 'MessageSquare' },
  { path: '/app/jobs', labelKey: 'nav.careers', icon: 'Briefcase' },
  { path: '/app/glossary', labelKey: 'nav.glossary', icon: 'Scroll' },
  { path: '/guide', labelKey: 'nav.guide', icon: 'Map' },
  { path: '/connect', labelKey: 'nav.connectAi', icon: 'Plug' },
  { path: '/app/agents', labelKey: 'nav.agents', icon: 'Bot' },
  { path: '/app/notifications', labelKey: 'nav.notifications', icon: 'Bell' },
  { path: '/app/messages', labelKey: 'nav.messages', icon: 'MessageSquare' },
  { path: '/app/bookmarks', labelKey: 'nav.bookmarks', icon: 'Bookmark' },
  { path: '/app/settings', labelKey: 'nav.settings', icon: 'SettingsCog' },
  { path: '/app/superpowers', labelKey: 'nav.superpowers', icon: 'Zap' },
  { path: '/governance', labelKey: 'nav.governance', icon: 'Vote', storefrontHidden: true },
  { path: '/dao', labelKey: 'nav.dao', icon: 'Landmark', storefrontHidden: true },
  { path: '/work', labelKey: 'screens.work', icon: 'Hammer', storefrontHidden: true },
  { path: '/work/history', labelKey: 'work.myBounties', icon: 'Hammer', storefrontHidden: true },
  { path: '/affiliate', labelKey: 'nav.affiliate', icon: 'Handshake', storefrontHidden: true },
  { path: '/app/wallet', labelKey: 'nav.wallet', icon: 'Wallet', storefrontHidden: true },
  { path: '/app/stake', labelKey: 'nav.staking', icon: 'Vault', storefrontHidden: true },
  { path: '/app/buy', labelKey: 'buyCoins.title', icon: 'Wallet', storefrontHidden: true },
  { path: '/app/bridge', labelKey: 'nav.bridge', icon: 'ArrowLeftRight', storefrontHidden: true },
  { path: '/app/fractions', labelKey: 'nav.fractions', icon: 'ChartPie', storefrontHidden: true },
  { path: '/usernames', labelKey: 'screens.usernames', icon: 'AtSign', storefrontHidden: true },
  { path: '/accounts', labelKey: 'screens.accounts', icon: 'IdCard', storefrontHidden: true },
  { path: '/app/ads', labelKey: 'nav.ads', icon: 'Megaphone', storefrontHidden: true },
  { path: '/tv', labelKey: 'nav.tv', icon: 'Tv', storefrontHidden: true },
  { path: '/apps', labelKey: 'miniApps.store.title', icon: 'LayoutGrid', storefrontHidden: true },
  { path: '/converter', labelKey: 'nav.converter', icon: 'ArrowDownToLine', storefrontHidden: true },
  { path: '/migrate-youtube', labelKey: 'nav.migrate', icon: 'FolderInput', storefrontHidden: true },
  { path: '/compare', labelKey: 'comparison.title', icon: 'Scroll', storefrontHidden: true },
  { path: '/premium', labelKey: 'nav.premium', icon: 'Crown', storefrontHidden: true },
  { path: '/pricing', labelKey: 'nav.pricing', icon: 'Tag', storefrontHidden: true },
  { path: '/planned', labelKey: 'planned.title', icon: 'CalendarDays' },
  { path: '/live-studio', labelKey: 'liveStudio.title', icon: 'Tv' },
  { path: '/launchpad', labelKey: 'launchpad.title', icon: 'ChartColumn', storefrontHidden: true },
  { path: '/docs', labelKey: 'nav.docs', icon: 'BookOpen', storefrontHidden: true },
  { path: '/docs/blog', labelKey: 'nav.blog', icon: 'Blog', storefrontHidden: true },
];

const swap = (path: string) => (path.startsWith('/app/') ? path.slice(4) : `/app${path}`);

/** The page a card stands for, falling back to the page an item sits on. */
export function linkablePageFor(pagePath: string): LinkablePage | null {
  const find = (p: string) => LINKABLE_PAGES.find((page) => page.path === p || page.path === swap(p)) ?? null;
  const own = find(pagePath);
  if (own) return own;
  const parent = appPageParent(pagePath);
  return parent ? find(parent) : null;
}
