/**
 * A scripted walk through the app's main page switches, timed frame by frame.
 *
 * Not part of the app: scripts/ios-nav-timing.sh adds an import of this file
 * to the entry file while it bundles for the simulator, and removes it again.
 * It only runs when that script has also written `dehub.perfTour` into the
 * app's storage before launch.
 *
 * Every step performs one navigation the way the app does (same navigators,
 * same profile sheet) and then watches requestAnimationFrame for a while. A
 * frame callback arrives late when either the JavaScript thread or the main
 * thread is busy, so the gaps between callbacks are the time the screen could
 * not update: building a page, or rebuilding one that had been torn down.
 */
import React from "react";
import { AppRegistry, Dimensions, StyleSheet, View } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { navigationRef } from "../../App";
import { ScreenNames } from "../../navigation/ScreenNames";
import { closeProfileSheetForLink, emitProfileDeepLink } from "../../libs/deeplink.events";
import { createVideoPlayer } from "expo-video";
import { getShortsFeed, getUnifiedFeed } from "../../services/feed.unified.service";

const FLAG_KEY = "dehub.perfTour";
const RESULT_KEY = "dehub.perfTour.result";
/** Set while Settings is open and waiting for the script's edge swipe. */
const SWIPE_KEY = "dehub.perfTour.swipe";
/** The script screenshots the simulator each time this changes. */
const SHOT_KEY = "dehub.perfTour.shot";
/** emitProfileDeepLink waits this long before it opens the profile. */
const PROFILE_LINK_DELAY_MS = 350;
const FRAME_MS = 1000 / 60;

type StepResult = {
  step: string;
  /** Wall clock at the action, to line the step up with the screen recording. */
  wall: number;
  /** The action call itself: the synchronous part of the navigation. */
  actionMs: number;
  /** Longest time between two frames after the action. */
  worstMs: number;
  /** Frames that took over two frame slots. */
  slowFrames: number;
  /** Time lost to late frames, in total. */
  blockedMs: number;
  /** When the last late frame ended: the screen was free to update from here on. */
  settledMs: number;
  frames: number;
  route: string | undefined;
};

const now = (): number => globalThis.performance.now();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nav = navigationRef as unknown as {
  isReady(): boolean;
  navigate(name: string, params?: object): void;
  goBack(): void;
  canGoBack(): boolean;
  getCurrentRoute(): { name: string } | undefined;
  getRootState(): { index: number; routes: { name: string }[] } | undefined;
};

const results: StepResult[] = [];
let extra: Record<string, unknown> = {};

async function save(done: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(RESULT_KEY, JSON.stringify({ done, ...extra, steps: results }));
  } catch {
    // The run still logs every step below.
  }
}

async function measure(step: string, action: () => void, opts: { watchMs?: number; delayMs?: number; restMs?: number } = {}): Promise<void> {
  const watchMs = opts.watchMs ?? 1600;
  const stamps: number[] = [];
  let alive = true;
  const loop = () => {
    if (!alive) return;
    stamps.push(now());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await sleep(200);
  const wall = Date.now();
  const start = now();
  try {
    action();
  } catch (error) {
    console.error(`[perf-tour] ${step} threw ${String(error)}`);
  }
  const actionMs = now() - start;
  // Some actions only take effect after a fixed wait of their own.
  const origin = start + (opts.delayMs ?? 0);
  await sleep(watchMs + (opts.delayMs ?? 0));
  alive = false;

  const after = stamps.filter((t) => t >= origin);
  let previous = origin;
  let worstMs = 0;
  let slowFrames = 0;
  let blockedMs = 0;
  let settledMs = 0;
  for (const t of after) {
    const gap = t - previous;
    if (gap > worstMs) worstMs = gap;
    if (gap > FRAME_MS * 2) {
      slowFrames += 1;
      blockedMs += gap - FRAME_MS;
      settledMs = t - origin;
    }
    previous = t;
  }
  const result: StepResult = {
    step,
    wall: wall + (opts.delayMs ?? 0),
    actionMs: Math.round(actionMs),
    worstMs: Math.round(worstMs),
    slowFrames,
    blockedMs: Math.round(blockedMs),
    settledMs: Math.round(settledMs),
    frames: after.length,
    route: nav.getCurrentRoute()?.name,
  };
  results.push(result);
  console.error(`[perf-tour] ${JSON.stringify(result)}`);
  await save(false);
  await sleep(opts.restMs ?? 900);
}

const tab = (name: string) => () =>
  nav.navigate(ScreenNames.App, { screen: ScreenNames.Root, params: { screen: name } });
const feedTab = (feed: string) => () =>
  nav.navigate(ScreenNames.App, { screen: ScreenNames.Root, params: { screen: ScreenNames.Home, params: { feedTab: feed } } });
const push = (name: string, params?: object) => () => nav.navigate(name, params);
// Never from a bottom-bar tab: under those is the welcome flow a fresh install
// started in, and a page that did not open (signed out) must not lead there.
const back = () => () => {
  const route = nav.getCurrentRoute()?.name;
  if (nav.canGoBack() && route && !TAB_ROUTES.includes(route)) nav.goBack();
};
const openProfile = (name: string) => () => emitProfileDeepLink(name);
const closeProfile = () => () => closeProfileSheetForLink();

/**
 * Every page that opens without being handed something (a post, a chat, a
 * file). Signed-in pages are included: signed out they show their sign-in
 * state, which has to open as fast as the page would.
 */
const PAGES = [
  "AccountSettings", "NotificationSettings", "PrivacySettings", "ActiveSessions", "EditProfile",
  "Search", "Notifications", "LiveChat", "FeatureRequests", "Planned", "Feedback",
  "Leaderboard", "Top100", "Stats", "Communities", "Creators", "Events", "Stages", "Cinema", "TV",
  "YourVideos", "LikedVideos", "SavedPosts", "MyLibrary", "Drafts", "UploadQueue", "Earnings", "Affiliate",
  "Premium", "Pricing", "SuperPowers", "Usernames", "Accounts", "Packs", "Fractions", "NftMarket",
  "Governance", "Dao", "Launchpad", "Raffle", "Bridge", "Dex", "Dpay", "DePin", "Converter",
  "Agents", "Builder", "Apps", "Arcade", "Work", "Creator", "CreatorStudio", "CreatorLearning",
  "Connect", "Compare", "Guide", "Glossary", "Careers", "Ads", "CommandCentre", "Migrate",
] as const;

const TAB_ROUTES: string[] = [ScreenNames.Home, ScreenNames.Explore, ScreenNames.DM, ScreenNames.AIChat];

/** The script samples the app's threads for a while once this is set. */
const SAMPLE_KEY = "dehub.perfTour.sample";

/**
 * Signed out, the Messages and Assistant tabs and the account pages do not
 * open: the app shows its sign-in sheet instead, which then covers every
 * later step. Those steps only run with a session.
 */
async function hasSession(): Promise<boolean> {
  try {
    const { getAuthToken } = require("../../libs/auth.utils") as { getAuthToken(): Promise<string | null> };
    return !!(await getAuthToken());
  } catch {
    return false;
  }
}

/** Pages the app only has for a signed-in account. */
const ACCOUNT_PAGES = new Set([
  "AccountSettings", "NotificationSettings", "PrivacySettings", "ActiveSessions", "EditProfile", "Notifications",
  "LiveChat", "YourVideos", "LikedVideos", "SavedPosts", "MyLibrary", "Drafts", "UploadQueue", "Earnings",
  "Affiliate", "Dex", "Dpay", "Ads", "CommandCentre",
]);

const shot = (name: string) => AsyncStorage.setItem(SHOT_KEY, name).catch(() => undefined);

/**
 * Pages that show the account's own contact details and devices. With the
 * script's "private" flag (a real account on a run anyone can download) they
 * are timed like the rest but never pictured.
 */
const PERSONAL_PAGES = new Set(["AccountSettings", "ActiveSessions", "EditProfile", "PrivacySettings", "NotificationSettings"]);

/** Back out of whatever is open until a bottom-bar tab is showing again. */
async function backToTabs(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const route = nav.getCurrentRoute()?.name;
    if (!route || TAB_ROUTES.includes(route) || !nav.canGoBack()) return;
    nav.goBack();
    await sleep(500);
  }
}

/** Opens every page twice: the first visit builds it, the second shows what was kept. */
async function runPages(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "pages" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);
  const names = ScreenNames as unknown as Record<string, string>;
  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  const unpictured = (await AsyncStorage.getItem(`${FLAG_KEY}.private`)) === "1" ? PERSONAL_PAGES : new Set<string>();
  let index = 0;
  for (const page of PAGES) {
    const name = names[page];
    index += 1;
    if (!name || (!signedIn && ACCOUNT_PAGES.has(page))) continue;
    const label = `${String(index).padStart(2, "0")}-${page}`;
    await measure(`${page} open (first)`, push(name), { watchMs: 2400, restMs: 300 });
    const reached = nav.getCurrentRoute()?.name === name;
    // Pictures: the page once it has settled, and (below) the page half a
    // second into its second visit, when anything it kept should be showing.
    if (!unpictured.has(page)) await shot(label);
    await sleep(900);
    await measure(`${page} back`, back(), { watchMs: 900, restMs: 300 });
    await backToTabs();
    if (!reached) continue;
    await measure(`${page} open again`, () => {
      nav.navigate(name);
      if (!unpictured.has(page)) setTimeout(() => void shot(`${label}-again`), 450);
    }, { watchMs: 1500, restMs: 300 });
    await measure(`${page} back again`, back(), { watchMs: 900, restMs: 300 });
    await backToTabs();
  }
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

// --- measured page layouts ("bones") ------------------------------------------

/** The app's root view, kept so the layout tree under it can be read. */
let tourRoot: any = null;
AppRegistry.setWrapperComponentProvider(() => function TourRoot({ children }: { children?: React.ReactNode }) {
  return React.createElement(View, { style: { flex: 1 }, collapsable: false, ref: (r: unknown) => { if (r) tourRoot = r; } }, children);
});

type Fiber = { tag: number; type: unknown; child: Fiber | null; sibling: Fiber | null; return: Fiber | null; stateNode: any; memoizedProps: any };
type Bone = [x: number, y: number, w: number, h: number, r: number, kind: string];
const BONES_KEY = "dehub.perfTour.bones";

const rgbaAlpha = (color: unknown): number => {
  if (typeof color !== "string") return 0;
  if (color === "transparent") return 0;
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; }
  if (/^#[0-9a-f]{8}$/i.test(color)) return parseInt(color.slice(7), 16) / 255;
  if (/^#[0-9a-f]{4}$/i.test(color)) return parseInt(color[4] + color[4], 16) / 255;
  return 1;
};
const brightness = (color: unknown): number => {
  if (typeof color !== "string") return 0;
  const m = /rgba?\(([^)]+)\)/.exec(color);
  let p: number[] | null = null;
  if (m) p = m[1].split(/[ ,/]+/).map(parseFloat);
  else if (/^#[0-9a-f]{6,8}$/i.test(color)) p = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  else if (/^#[0-9a-f]{3,4}$/i.test(color)) p = [1, 2, 3].map((i) => parseInt(color[i] + color[i], 16));
  else if (color === "white") p = [255, 255, 255];
  return p ? (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000 : 0;
};

function rectOf(fiber: Fiber): [number, number, number, number] | null {
  try {
    const ui = (globalThis as any).nativeFabricUIManager;
    const node = fiber.stateNode?.node;
    if (ui?.getBoundingClientRect && node) {
      const r = ui.getBoundingClientRect(node, true);
      if (r) return [r[0], r[1], r[2], r[3]];
    }
    const inst = fiber.stateNode?.canonical?.publicInstance ?? fiber.stateNode?.publicInstance;
    const r = inst?.getBoundingClientRect?.();
    if (r) return [r.x, r.y, r.width, r.height];
  } catch {
    // Not a measurable node.
  }
  return null;
}

const textOf = (fiber: Fiber): string => {
  let out = "";
  const visit = (f: Fiber | null) => {
    for (let c = f; c; c = c.sibling) {
      if (c.tag === 6) out += String(c.memoizedProps ?? "");
      else visit(c.child);
    }
  };
  visit(fiber.child);
  return out;
};

/** The layout of the page on top: a bar per line of text, a block per picture and control, a panel per card. */
function measureScreen(routeKey: string | undefined): { w: number; h: number; top: number; bones: string; note?: string } | null {
  const handle: Fiber | undefined = tourRoot?.__internalInstanceHandle ?? tourRoot?._internalFiberInstanceHandleDEV;
  if (!handle) return { w: 0, h: 0, top: 0, bones: "", note: "no root fiber" };
  // The handle may be either copy of its fiber. Climb to the root and come
  // back down the committed tree, or a page that rendered once measures empty.
  let top: Fiber = handle;
  while (top.return) top = top.return;
  const committed: Fiber = top.stateNode?.current ?? top;
  const { width: W, height: H } = Dimensions.get("window");
  // The page on top: the shallowest component handed this route.
  let screen: Fiber | null = null;
  const queue: Fiber[] = [committed];
  for (let i = 0; i < queue.length && i < 200000 && !screen; i++) {
    const f = queue[i];
    if (routeKey && f.memoizedProps && typeof f.memoizedProps === "object" && f.memoizedProps.route?.key === routeKey && f.memoizedProps.navigation) { screen = f; break; }
    if (f.child) queue.push(f.child);
    if (f.sibling) queue.push(f.sibling);
  }
  if (!screen) return { w: W, h: H, top: 0, bones: "", note: "route not found" };
  const bones: Bone[] = [];
  const maxY = H * 1.25;
  const push = (r: number[], radius: number, kind: string) => {
    const x = Math.max(0, r[0]);
    const right = Math.min(W, r[0] + r[2]);
    const w = right - x;
    if (w < 3 || r[3] < 3 || r[1] > maxY || r[1] + r[3] < 0) return;
    const h = Math.min(r[3], maxY - r[1]);
    bones.push([Math.round((x / W) * 1000), Math.round(r[1]), Math.round((w / W) * 1000), Math.round(h), Math.round(Math.min(radius || 0, h / 2, w / 2)), kind]);
  };
  const walk = (fiber: Fiber | null, clip: number[] | null) => {
    for (let f = fiber; f; f = f.sibling) {
      if (f.tag !== 5) { walk(f.child, clip); continue; }
      const type = String(f.type);
      const style = (StyleSheet.flatten(f.memoizedProps?.style) ?? {}) as Record<string, any>;
      // Opacity is not read: a page that fades its content in keeps the
      // starting 0 in its props while the native side has long reached 1.
      if (style.display === "none") continue;
      let r = rectOf(f);
      if (!r) { walk(f.child, clip); continue; }
      if (r[1] > maxY || r[1] + r[3] < -4 || r[0] >= W || r[0] + r[2] <= 0) continue;
      if (clip) {
        const left = Math.max(r[0], clip[0]), top = Math.max(r[1], clip[1]);
        const right = Math.min(r[0] + r[2], clip[0] + clip[2]), bottom = Math.min(r[1] + r[3], clip[1] + clip[3]);
        if (right - left <= 0 || bottom - top <= 0) continue;
        r = [left, top, right - left, bottom - top];
      }
      const radius = Number(style.borderRadius ?? style.borderTopLeftRadius ?? 0) || 0;
      if (/Text$/.test(type) && !/Input/.test(type)) {
        const text = textOf(f).trim();
        if (!text) continue;
        const fs = Number(style.fontSize) || 14;
        const family = String(style.fontFamily ?? "").toLowerCase();
        const glyph = text.length <= 2 && /[\ue000-\uf8ff]|[\u{f0000}-\u{10ffff}]/u.test(text);
        if (glyph || /ionicons|material|feather|fontawesome|entypo|antdesign|octicons|simplelineicons|evilicons|foundation|zocial/.test(family)) {
          push([r[0] + (r[2] - Math.min(r[2], fs)) / 2, r[1] + (r[3] - Math.min(r[3], fs)) / 2, Math.min(r[2], fs), Math.min(r[3], fs)], Math.min(6, fs / 3), "i");
          continue;
        }
        const lh = Number(style.lineHeight) || fs * 1.3;
        const lines = Math.max(1, Math.round(r[3] / lh));
        const barH = Math.max(6, Math.min(22, Math.round(fs * 0.66)));
        const rowH = r[3] / lines;
        const guess = text.length * fs * 0.54;
        for (let i = 0; i < lines; i++) {
          let w = lines === 1 ? Math.min(r[2], guess) : i === lines - 1 ? Math.min(r[2], Math.max(r[2] * 0.3, guess - r[2] * (lines - 1))) : r[2];
          w = Math.max(w, Math.min(r[2], 18));
          const align = style.textAlign;
          const x = align === "center" ? r[0] + (r[2] - w) / 2 : align === "right" ? r[0] + r[2] - w : r[0];
          push([x, r[1] + i * rowH + (rowH - barH) / 2, w, barH], Math.min(barH / 2, 5), "t");
        }
        continue;
      }
      if (/Image|Video|Svg|SVG|Lottie|Canvas|WebView|Gradient|Blur|Skia|Camera|Map/.test(type) && !/BlurView|Gradient/.test(type)) {
        const small = r[2] <= 28 && r[3] <= 28;
        push(r, small ? Math.min(6, r[2] / 3) : radius, small ? "i" : "b");
        continue;
      }
      if (/TextInput|Switch|Slider/.test(type)) { push(r, radius || 8, "s"); continue; }
      let nextClip = clip;
      const bgA = rgbaAlpha(style.backgroundColor);
      const borderA = Number(style.borderWidth ?? style.borderTopWidth ?? style.borderBottomWidth ?? 0) > 0 ? rgbaAlpha(style.borderColor ?? style.borderTopColor ?? style.borderBottomColor ?? "#000") : 0;
      if ((bgA > 0.02 || borderA > 0.04) && r[3] >= 16 && r[2] >= 16 && !(r[2] >= W - 1 && r[3] >= H * 0.6)) {
        const solid = bgA > 0.6 && r[3] <= 64 && r[2] <= W * 0.7 && brightness(style.backgroundColor) > 150;
        push(r, radius, solid ? "b" : "s");
        if (solid) continue;
      }
      if (style.overflow === "hidden" || /ScrollView|ScrollContent/.test(type)) {
        nextClip = clip ? [Math.max(r[0], clip[0]), Math.max(r[1], clip[1]), Math.min(r[0] + r[2], clip[0] + clip[2]) - Math.max(r[0], clip[0]), Math.min(r[1] + r[3], clip[1] + clip[3]) - Math.max(r[1], clip[1])] : /ScrollContent/.test(type) ? clip : r;
      }
      walk(f.child, nextClip);
    }
  };
  walk(screen.child, null);
  const order = (k: string) => (k === "s" ? 0 : 1);
  bones.sort((a, b) => order(a[5]) - order(b[5]) || a[1] - b[1] || a[0] - b[0]);
  const kept: Bone[] = [];
  for (const b of bones) {
    if (b[5] === "s" && kept.some((m) => m[5] === "s" && Math.abs(m[0] - b[0]) <= 3 && Math.abs(m[1] - b[1]) <= 2 && Math.abs(m[2] - b[2]) <= 6 && Math.abs(m[3] - b[3]) <= 4)) continue;
    kept.push(b);
  }
  return { w: Math.round(W), h: Math.round(H), top: Math.round(initialWindowMetrics?.insets.top ?? 0), bones: kept.map((b) => b.join(",")).join(";") };
}

/** Opens every page, waits for it to settle, and saves its measured layout and a picture. */
async function runBones(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "bones" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);
  const names = ScreenNames as unknown as Record<string, string>;
  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  const unpictured = (await AsyncStorage.getItem(`${FLAG_KEY}.private`)) === "1" ? PERSONAL_PAGES : new Set<string>();
  const all: Record<string, unknown> = {};
  let index = 0;
  for (const page of [...PAGES, ...SHELL_EXTRA_PAGES]) {
    const name = names[page];
    index += 1;
    if (!name || (!signedIn && ACCOUNT_PAGES.has(page))) continue;
    nav.navigate(name);
    await sleep(4200);
    const current = nav.getCurrentRoute() as { name: string; key?: string } | undefined;
    if (current?.name === name) {
      try {
        const measured = measureScreen(current.key);
        if (measured) all[name] = measured.note ? measured : [measured.w, measured.h, measured.top, measured.bones];
      } catch (error) {
        all[name] = { note: String(error) };
      }
      await AsyncStorage.setItem(BONES_KEY, JSON.stringify(all)).catch(() => undefined);
      if (!unpictured.has(page)) await shot(`${String(index).padStart(2, "0")}-${page}`);
      await sleep(1700);
    }
    back()();
    await sleep(700);
    await backToTabs();
    await save(false);
  }
  extra.measured = Object.keys(all).length;
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

/** Pages the shell tour opens on top of the page tour's list. */
const SHELL_EXTRA_PAGES = [
  "CreatorFlow", "LaunchpadCreate", "WorkPost", "WorkHistory", "WorkDisputes", "LiveStudio", "TvRequests",
  "SignInTv", "Prompt", "ConnectGuide", "FollowList", "PostInfo", "Feed",
] as const;

/**
 * Every page's loading shell next to the page itself: the page is first held
 * on its shell (deferredScreen's hold flag) and pictured, then opened for real
 * and pictured again once it has settled.
 */
async function runShells(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "shells" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);
  const names = ScreenNames as unknown as Record<string, string>;
  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  const unpictured = (await AsyncStorage.getItem(`${FLAG_KEY}.private`)) === "1" ? PERSONAL_PAGES : new Set<string>();
  const hold = globalThis as { __holdRouteShell?: boolean };
  const opened: string[] = [];
  let index = 0;
  for (const page of [...PAGES, ...SHELL_EXTRA_PAGES]) {
    const name = names[page];
    index += 1;
    if (!name || (!signedIn && ACCOUNT_PAGES.has(page))) continue;
    const label = `${String(index).padStart(2, "0")}-${page}`;
    hold.__holdRouteShell = true;
    nav.navigate(name);
    await sleep(1100);
    const reached = nav.getCurrentRoute()?.name === name;
    if (reached) await shot(`${label}-1shell`);
    await sleep(1700);
    hold.__holdRouteShell = false;
    back()();
    await sleep(700);
    await backToTabs();
    if (!reached) continue;
    opened.push(page);
    nav.navigate(name);
    await sleep(3200);
    if (!unpictured.has(page)) await shot(`${label}-2page`);
    await sleep(1700);
    back()();
    await sleep(700);
    await backToTabs();
    await save(false);
  }
  extra.opened = opened;
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

/**
 * Real touches, made by the script: does a slow swipe in from the left edge
 * leave the page, and does a tap on Back land. A picture is taken before and
 * after each, so a touch that did nothing shows what was on screen.
 */
async function runTouch(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "touch" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);
  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  const checks: { check: string; opened: boolean; went: boolean; endedOn: string | undefined }[] = [];
  extra.touch = checks;
  const touchOn = async (check: string, page: string, request: string, open: () => void = () => nav.navigate(page)) => {
    open();
    await sleep(2200);
    const opened = nav.getCurrentRoute()?.name === page;
    let went = false;
    if (opened) {
      await shot(`${check}-before`);
      await sleep(600);
      await AsyncStorage.setItem(SWIPE_KEY, `${request.startsWith("tap") ? "tap" : "swipe"}:${check}${request.startsWith("tap") ? request.slice(3) : ""}`);
      const since = Date.now();
      while (!went && Date.now() - since < 12000) {
        await sleep(50);
        went = nav.getCurrentRoute()?.name !== page;
      }
      await sleep(700);
      await shot(`${check}-after`);
      await sleep(600);
    }
    checks.push({ check, opened, went, endedOn: nav.getCurrentRoute()?.name });
    console.error(`[perf-tour] ${check}: ${!opened ? "page did not open" : went ? "left the page" : "did nothing"}`);
    await save(false);
    await backToTabs();
    await sleep(800);
  };
  // A fresh sign-in is offered a profile photo a few seconds in and
  // notifications 20 seconds in, so the second is asked for while the first
  // is still up. A person answers both before going anywhere: wait until both
  // have been raised, then tap "Not now" wherever it is drawn, three times
  // over (the second ask can only show once the first has closed).
  await shot("0-home-start");
  await sleep(16000);
  let asks = 0;
  const tapAt = async (label: string, x: number, y: number) => {
    asks += 1;
    await AsyncStorage.setItem(SWIPE_KEY, `tap:${label}-${asks}:${x}:${y}`);
    await sleep(4500);
    await shot(`0-${label}-${asks}`);
    await sleep(700);
  };
  const tapButton = async (label: string, text: string) => {
    asks += 1;
    await shot(`0-${label}-${asks}-before`);
    await sleep(700);
    await AsyncStorage.setItem(SWIPE_KEY, `find:${label}-${asks}:${text}`);
    await sleep(7000);
  };
  for (let round = 0; round < 3; round++) await tapButton("not-now", "Not now");
  await shot("0-asks-answered");
  await sleep(700);
  // A tap that needs no page open: the Search tab in the bottom bar.
  await tapAt("search-tab", 307, 812);
  checks.push({ check: "0-tap-search-tab", opened: true, went: nav.getCurrentRoute()?.name === ScreenNames.Explore, endedOn: nav.getCurrentRoute()?.name });
  console.error(`[perf-tour] 0-tap-search-tab: ended on ${nav.getCurrentRoute()?.name}`);
  nav.navigate(ScreenNames.Home);
  await sleep(1500);
  await touchOn("1-swipe-leaderboard", ScreenNames.Leaderboard, "swipe");
  await touchOn("2-swipe-requests", ScreenNames.FeatureRequests, "swipe");
  await touchOn("3-swipe-search", ScreenNames.Search, "swipe");
  const photos = await getUnifiedFeed({ postType: "feed-images", page: 1, limit: 20 });
  const photo = photos.result?.find((item) => (item.imageUrls?.length ?? 0) <= 1);
  if (!photo) throw new Error("Could not load a single-photo post for the Back check");
  await touchOn("4-swipe-profile-photos", ScreenNames.ImageFeed, "swipe", () => {
    nav.navigate(ScreenNames.ImageFeed, { initialItems: [photo], initialIndex: 0 });
  });
  if (signedIn) {
    nav.navigate(ScreenNames.Notifications);
    await sleep(2500);
    if (nav.getCurrentRoute()?.name === ScreenNames.Notifications) nav.goBack();
    await sleep(1800);
    await touchOn("5-swipe-leaderboard-after-bell", ScreenNames.Leaderboard, "swipe");
  }
  // Back's arrow sits at the left of the top pill.
  await touchOn("6-tap-back-leaderboard", ScreenNames.Leaderboard, "tap:27:87");
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

/**
 * Shorts: how soon the next short is moving after a real finger swipe. The
 * script makes the swipes with idb and notes when each began; this side
 * watches every video player the app starts or loads and notes the moment
 * each one's clock starts running. Players are found through expo-video's
 * own prototype, so main's code and this checkout's are watched the same way.
 */
async function runShorts(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "shorts" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);
  type Watched = { id: number; lastT: number; lastChange: number; moving: boolean };
  const players = new Map<object, Watched>();
  const motions: { wall: number; player: number; at: number }[] = [];
  extra.motions = motions;
  // Every play() asked of a player, so a start that never ran shows too.
  const plays: { wall: number; player: number; at: number }[] = [];
  extra.plays = plays;
  let nextId = 1;
  try {
    const probe = createVideoPlayer(null);
    const proto = Object.getPrototypeOf(probe) as Record<string, unknown>;
    const patched: string[] = [];
    for (const name of ["play", "replaceAsync", "replace", "release"]) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      proto[name] = function (this: object, ...args: unknown[]) {
        if (name === "release") {
          players.delete(this);
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        }
        if (!players.has(this)) players.set(this, { id: nextId++, lastT: -1, lastChange: 0, moving: false });
        if (name === "play") {
          let at = -1;
          try { at = Math.round((this as { currentTime: number }).currentTime * 1000); } catch {}
          plays.push({ wall: Date.now(), player: players.get(this)!.id, at });
        }
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      patched.push(name);
    }
    probe.release();
    extra.patched = patched;
  } catch (error) {
    extra.patched = String(error);
  }
  const sampler = setInterval(() => {
    const wall = Date.now();
    for (const [player, watched] of players) {
      let t: unknown;
      try { t = (player as { currentTime: number }).currentTime; } catch { players.delete(player); continue; }
      if (typeof t !== "number") continue;
      if (t !== watched.lastT) {
        if (t > watched.lastT && watched.lastT >= 0 && !watched.moving) {
          watched.moving = true;
          motions.push({ wall, player: watched.id, at: Math.round(t * 1000) });
        }
        watched.lastT = t;
        watched.lastChange = wall;
      } else if (watched.moving && wall - watched.lastChange > 150) {
        watched.moving = false;
      }
    }
  }, 16);
  // Opened the way the Home row opens it: on a list of shorts. Opened on
  // nothing, main's viewer never asked for a list and sat on its wheel.
  let shorts: unknown[] = [];
  try {
    shorts = (await getShortsFeed({ page: 1, limit: 20, sortBy: "views" })).result || [];
  } catch (error) {
    extra.feedError = String(error);
  }
  extra.shorts = shorts.length;
  nav.navigate(ScreenNames.ShortsViewer, { initialIndex: 0, initialItems: shorts, initialPage: 1, feedParams: { sortBy: "views" } });
  await sleep(8000);
  extra.opened = nav.getCurrentRoute()?.name === ScreenNames.ShortsViewer;
  await shot("shorts-open");
  const count = Number(await AsyncStorage.getItem(`${FLAG_KEY}.swipes`)) || 12;
  // Per swipe: what the app holds, to see a long scroll pile players up.
  const samples: Record<string, unknown>[] = [];
  extra.samples = samples;
  const heapMB = () => {
    try {
      const stats = (globalThis as any).HermesInternal?.getInstrumentedStats?.();
      return typeof stats?.js_heapSize === "number" ? Math.round(stats.js_heapSize / 1048576) : null;
    } catch { return null; }
  };
  const sessionStats = () => {
    try { return (require("../../libs/post-media-session") as any).postMediaStats?.() ?? null; } catch { return null; }
  };
  for (let i = 1; i <= count && extra.opened; i++) {
    const ranBefore = new Set(motions.map((m) => m.player));
    const asked = Date.now();
    await AsyncStorage.setItem(SWIPE_KEY, `vswipe:shorts-${i}`);
    // The shell acts on the request within 2 s; then the new short has 2 s to move.
    await sleep(4000);
    const started = motions.some((m) => m.wall >= asked && !ranBefore.has(m.player));
    // A picture of a swipe that brought nothing moving, and of a few others.
    if (!started) await shot(`shorts-stuck-${i}`);
    else if (i <= 8 || i % 25 === 0) await shot(`shorts-swipe-${i}`);
    samples.push({ i, wall: Date.now(), started, heapMB: heapMB(), livePlayers: players.size, posts: sessionStats() });
    await sleep(1500);
    if (i % 5 === 0 || i === count) await save(false);
  }
  // A swipe that starts on the timeline row, sent soon after landing on a
  // short, while its bar still takes touches: it has to turn the page too.
  for (let i = 1; i <= 4 && extra.opened; i++) {
    await AsyncStorage.setItem(SWIPE_KEY, `vpair:shorts-${i}`);
    await sleep(9000);
    await save(false);
  }
  clearInterval(sampler);
  await shot("shorts-end");
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] shorts done, ${motions.length} starts seen`);
}

/**
 * Wide clip in the swipe player: one wide video opened on its own, pictured
 * with its buttons up and again once they have faded, then its full screen
 * button pressed (found by its label) and Back from there. The script runs
 * this once per theme.
 */
async function runWide(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "wide" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const tokenId = Number(await AsyncStorage.getItem(`${FLAG_KEY}.token`)) || 7444;
  nav.navigate(ScreenNames.ShortsViewer, { initialItems: [{ tokenId, id: tokenId, postType: "video" }], initialIndex: 0 });
  await sleep(6500);
  extra.opened = nav.getCurrentRoute()?.name === ScreenNames.ShortsViewer;
  await shot("wide-1-buttons");
  await sleep(700);
  // A finger on the scrubber, pictured while it is still down: the row sits
  // above the player's buttons, which close the screen.
  const scrubY = Math.round(Dimensions.get("window").height - 16 - 40 - 22);
  await AsyncStorage.setItem(SWIPE_KEY, `scrub:wide-scrub:${scrubY}`);
  await sleep(4200);
  await shot("wide-1b-scrub");
  await sleep(9000);
  await shot("wide-2-clear");
  await sleep(700);
  // On the plain stage: the + under the video opens Info Stage, and the
  // button across from Back closes it.
  const theme = await AsyncStorage.getItem("dehub.theme");
  if (theme === "system" || theme === "system-light" || theme === "minimal") {
    await AsyncStorage.setItem(SWIPE_KEY, "find:wide-info-open:Show more");
    await sleep(8000);
    await shot("wide-2b-info");
    await sleep(700);
    await AsyncStorage.setItem(SWIPE_KEY, "find:wide-info-close:Show less");
    await sleep(6000);
    await shot("wide-2c-stage-again");
    await sleep(700);
  }
  await AsyncStorage.setItem(SWIPE_KEY, "find:wide-fullscreen:Enter fullscreen");
  await sleep(8000);
  extra.fullscreen = nav.getCurrentRoute()?.name;
  await shot("wide-3-fullscreen");
  await sleep(700);
  if (extra.fullscreen === ScreenNames.FullscreenVideo) {
    // Minimise closes full screen (it used to turn the clip upright and stay).
    await AsyncStorage.setItem(SWIPE_KEY, "find:wide-minimise:Close video");
    await sleep(8000);
    extra.minimiseClosed = nav.getCurrentRoute()?.name !== ScreenNames.FullscreenVideo;
    if (!extra.minimiseClosed) nav.goBack();
    await sleep(1500);
  }
  extra.back = nav.getCurrentRoute()?.name;
  await shot("wide-4-back");
  await sleep(700);
  // The same clip on its post page: full screen grows out of the player's
  // box and turns sideways; Minimise turns back and shrinks into the box.
  nav.navigate(ScreenNames.PostInfo, { tokenId: String(tokenId) });
  await sleep(9000);
  await shot("wide-5-post");
  await sleep(700);
  await AsyncStorage.setItem(SWIPE_KEY, "find:post-fullscreen:Fullscreen");
  await sleep(8000);
  extra.postFullscreen = nav.getCurrentRoute()?.name;
  await shot("wide-6-post-fullscreen");
  await sleep(700);
  if (extra.postFullscreen === ScreenNames.FullscreenVideo) {
    await AsyncStorage.setItem(SWIPE_KEY, "find:post-minimise:Close video");
    await sleep(8000);
  }
  extra.postBack = nav.getCurrentRoute()?.name;
  await shot("wide-7-post-back");
  await sleep(700);
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] wide done: opened ${String(extra.opened)}, full screen ${String(extra.fullscreen)}, minimise closed ${String(extra.minimiseClosed)}, back on ${String(extra.back)}, post full screen ${String(extra.postFullscreen)}, post back on ${String(extra.postBack)}`);
}

/**
 * A short left and come back to: two wide clips in the swipe player, the
 * first one playing, a real swipe to the second and one back. The first
 * short then has to show its moving picture again, not its poster over a
 * clip that plays on underneath. Pictured twice, two seconds apart, after
 * landing back on it (the picture must differ), and the same once more after
 * a sheet-like pause (the app made inactive and active again).
 */
async function runFreeze(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "freeze" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const first = Number(await AsyncStorage.getItem(`${FLAG_KEY}.token`)) || 7467;
  const items = [first, 8052, 7444].map((tokenId) => ({ tokenId, id: tokenId, postType: "video" }));
  nav.navigate(ScreenNames.ShortsViewer, { initialItems: items, initialIndex: 0 });
  await sleep(7000);
  extra.opened = nav.getCurrentRoute()?.name === ScreenNames.ShortsViewer;
  await shot("freeze-1a-first");
  await sleep(2000);
  await shot("freeze-1b-first-2s");
  await sleep(700);
  await AsyncStorage.setItem(SWIPE_KEY, "vswipe:freeze-next");
  await sleep(6000);
  await shot("freeze-2-second");
  await sleep(700);
  await AsyncStorage.setItem(SWIPE_KEY, "vback:freeze-back");
  await sleep(5000);
  await shot("freeze-3a-back");
  await sleep(2000);
  await shot("freeze-3b-back-2s");
  await sleep(700);
  // The app set aside without leaving the screen (Control Center, a call
  // banner): every short is told playback is not allowed, then allowed again.
  try {
    const { visualActivity } = require("../../libs/visualActivity") as { visualActivity?: { setForeground(v: boolean): void } };
    visualActivity?.setForeground(false);
    await sleep(1500);
    visualActivity?.setForeground(true);
    extra.inactive = !!visualActivity;
  } catch (error) {
    extra.inactive = String(error);
  }
  await sleep(4000);
  await shot("freeze-4a-after-inactive");
  await sleep(2000);
  await shot("freeze-4b-after-inactive-2s");
  await sleep(700);
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] freeze done: opened ${String(extra.opened)}, inactive ${String(extra.inactive)}`);
}

/**
 * Post separator: Home pictured with bento cards and with the thin line, the
 * same posts each time (the pref flips in place), at the top and after two
 * real flicks down the feed.
 */
/**
 * A shared video link: the route a riftn.com/app/post/<id> link resolves to,
 * opened from Home. It should land in the Shorts viewer on that video; Back
 * then shows the post page, and Back again Home.
 */
async function runShareLink(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "sharelink" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  await shot("sharelink-0-home");
  const tokenId = Number(await AsyncStorage.getItem(`${FLAG_KEY}.token`)) || 7444;
  nav.navigate(ScreenNames.App, { screen: ScreenNames.PostResolver, params: { tokenId: String(tokenId) } });
  await sleep(9000);
  extra.opened = nav.getCurrentRoute()?.name;
  await shot("sharelink-1-opened");
  await sleep(4000);
  nav.goBack();
  await sleep(5000);
  extra.back1 = nav.getCurrentRoute()?.name;
  await shot("sharelink-2-back");
  await sleep(4000);
  nav.goBack();
  await sleep(5000);
  extra.back2 = nav.getCurrentRoute()?.name;
  await shot("sharelink-3-back-again");
  await sleep(4000);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] sharelink done: opened ${String(extra.opened)}, back ${String(extra.back1)}, back again ${String(extra.back2)}`);
}

async function runFeedLine(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "feedline" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);
  const prefs = require("../../hooks/useAppPrefs") as typeof import("../../hooks/useAppPrefs");
  for (let step = 0; step < 3; step++) {
    if (step > 0) {
      await AsyncStorage.setItem(SWIPE_KEY, `vswipe:feedline-${step}`);
      await sleep(8000);
    }
    const first = step % 2 === 0 ? "bento" : "line";
    const second = first === "bento" ? "line" : "bento";
    // The script polls for a shot request every 2 s, so each picture gets
    // 5 s before the look flips again.
    prefs.setAppPref("feedSeparator", first);
    await sleep(3500);
    await shot(`feedline-${step}-${first}`);
    await sleep(5000);
    prefs.setAppPref("feedSeparator", second);
    await sleep(3500);
    await shot(`feedline-${step}-${second}`);
    await sleep(5000);
  }
  prefs.setAppPref("feedSeparator", "bento");
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] feedline done");
}

/**
 * Leaving a live in System Light: Home has to come back light at once, with
 * no dark frame and no freeze. Opens a live (one that is on air when there
 * is one), pictures it, goes Back and pictures Home at 0.3 s, 1.5 s and 5 s,
 * timing the frames around both switches.
 */
async function runLiveTheme(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "livetheme" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  let streamId = "";
  try {
    const { getLiveVideos } = require("../../services/live.service") as { getLiveVideos(p: object): Promise<any> };
    const res = await getLiveVideos({ unit: 50, sortMode: "recent" });
    const rows: any[] = Array.isArray(res) ? res : Array.isArray(res?.result) ? res.result : [];
    const onAir = rows.find((r) => r?.status === "live" || r?.isLive) ?? rows[0];
    streamId = String(onAir?._id ?? onAir?.id ?? "");
  } catch (error) {
    console.error(`[perf-tour] live list failed ${String(error)}`);
  }
  extra.streamId = streamId;
  await shot("live-0-home");
  await sleep(900);
  for (let round = 1; round <= 2; round++) {
    await measure(`live open ${round}`, push(ScreenNames.LiveViewer, { streamId }), { watchMs: 2500, restMs: 2500 });
    await shot(`live-${round}a-open`);
    await sleep(1500);
    void measure(`live back ${round}`, () => nav.goBack(), { watchMs: 5500, restMs: 0 });
    await sleep(200 + 300);
    await shot(`live-${round}b-back-0.3s`);
    await sleep(1200);
    await shot(`live-${round}c-back-1.5s`);
    await sleep(3500);
    await shot(`live-${round}d-back-5s`);
    await sleep(2000);
  }
  extra.back = nav.getCurrentRoute()?.name;
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] livetheme done: stream ${streamId || "none"}, back on ${String(extra.back)}`);
}

type ElementType = string | { displayName?: string; name?: string; render?: ElementType; type?: ElementType } | null;

function typeName(type: ElementType): string {
  if (typeof type === "string") return type;
  if (!type) return "null";
  return type.displayName || type.name || (type.render ? typeName(type.render) : "") || (type.type ? typeName(type.type) : "") || "anonymous";
}

/**
 * What the app does during a switch, for finding where the time goes: which
 * components were drawn again (counted where the app's JSX runtime creates
 * their elements), and, for the script's thread sampler, a run of plain tab
 * switches. Needs a bundle that kept its function names (--minify false).
 */
async function runProbe(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "probe" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);

  let counts: Map<string, number> | null = null;
  // The same count again in tenths of a second from the action, with the
  // time each tenth's drawing took: what is drawn in the navigation itself,
  // and what follows it.
  let slices: Map<number, { n: number; first: number; last: number; names: Map<string, number> }> | null = null;
  let sliceOrigin = 0;
  const runtime = require("../../libs/jsx/jsx-runtime") as Record<string, (type: ElementType, ...rest: unknown[]) => unknown>;
  for (const key of ["jsx", "jsxs"]) {
    const original = runtime[key];
    runtime[key] = function counted(type: ElementType, ...rest: unknown[]) {
      if (counts) {
        const name = typeName(type);
        counts.set(name, (counts.get(name) ?? 0) + 1);
        if (slices) {
          const t = now() - sliceOrigin;
          const key = Math.floor(t / 100);
          let slice = slices.get(key);
          if (!slice) slices.set(key, (slice = { n: 0, first: t, last: t, names: new Map() }));
          slice.n += 1;
          slice.last = t;
          slice.names.set(name, (slice.names.get(name) ?? 0) + 1);
        }
      }
      return original(type, ...rest);
    };
  }
  const drawn: Record<string, { total: number; top: [string, number][]; slices: unknown[]; stateAt: number[] }> = {};
  // When the navigators report the switch as done.
  let stateAt: number[] = [];
  (navigationRef as unknown as { addListener(event: string, listener: () => void): void }).addListener("state", () => {
    if (slices) stateAt.push(Math.round(now() - sliceOrigin));
  });
  const probe = async (step: string, action: () => void, opts: { watchMs?: number; delayMs?: number } = {}) => {
    counts = new Map();
    const timed = new Map<number, { n: number; first: number; last: number; names: Map<string, number> }>();
    stateAt = [];
    await measure(step, () => {
      sliceOrigin = now() + (opts.delayMs ?? 0);
      slices = timed;
      action();
    }, { watchMs: 1800, restMs: 100, ...opts });
    const all = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    counts = null;
    slices = null;
    drawn[step] = {
      total: all.reduce((sum, entry) => sum + entry[1], 0),
      top: all.slice(0, 40),
      stateAt,
      slices: [...timed.entries()].sort((a, b) => a[0] - b[0]).map(([key, slice]) => ({
        at: key * 100,
        n: slice.n,
        first: Math.round(slice.first),
        last: Math.round(slice.last),
        top: [...slice.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14),
      })),
    };
    extra.drawn = drawn;
    await save(false);
    await sleep(500);
  };

  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  const light = signedIn ? [ScreenNames.DM, ScreenNames.AIChat] : [ScreenNames.Explore, ScreenNames.Home];
  // Visit everything once first, so the counts are of switches, not first builds.
  for (const name of [ScreenNames.Explore, ...(signedIn ? light : []), ScreenNames.Home]) {
    tab(name)();
    await sleep(2500);
  }

  await probe("idle", () => undefined);
  if (signedIn) {
    await probe("tab Messages", tab(ScreenNames.DM));
    await probe("tab Assistant", tab(ScreenNames.AIChat));
    await probe("tab Messages again", tab(ScreenNames.DM));
  }
  await probe("tab Home", tab(ScreenNames.Home));
  await probe("tab Explore", tab(ScreenNames.Explore));
  await probe("tab Home again", tab(ScreenNames.Home));
  await probe("idle on Home", () => undefined);
  await probe("feed Shorts", feedTab("short"));
  await probe("feed All", feedTab("all"));
  await probe("profile open", openProfile("riftn"), { delayMs: PROFILE_LINK_DELAY_MS, watchMs: 2200 });
  await probe("profile close", closeProfile());
  await probe("post open", push(ScreenNames.FeedDetail, { tokenId: "742" }), { watchMs: 2200 });
  await probe("post back", back());
  await probe("search open", push(ScreenNames.Search));
  await probe("search back", back());

  // For the sampler: the two lightest tabs, back and forth, then Home and Explore.
  await AsyncStorage.setItem(SAMPLE_KEY, "light");
  await sleep(3000);
  extra.sampleLightAt = Date.now();
  for (let i = 0; i < 8; i++) {
    tab(light[i % 2])();
    await sleep(1100);
  }
  await sleep(2500);
  tab(ScreenNames.Home)();
  await sleep(2500);
  await AsyncStorage.setItem(SAMPLE_KEY, "home");
  await sleep(3000);
  for (let i = 0; i < 6; i++) {
    tab(i % 2 ? ScreenNames.Home : ScreenNames.Explore)();
    await sleep(1600);
  }
  await sleep(2500);

  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

/**
 * Signs in with a phone number and its code, the way the sign-in screen does
 * for an account that already exists: the code proves the number, the server
 * answers with the profile linked to it. No wallet key is involved, so the
 * session opens with reads working and signing locked, as on a new phone.
 *
 * This runs with the sign-in Apple's reviewers use, and the run's logs are
 * public: nothing here may put the number or the code in an error.
 */
async function signInWithPhoneCode(phone: string, code: string): Promise<{ username?: string; isNew: boolean }> {
  let stage = "send code";
  try {
    const { sendPhoneOtp, verifyPhoneOtp, getSupabaseAccessToken } = require("../../services/auth/supabaseAuth.service");
    const { fetchWalletReliably } = require("../../libs/wallet-core/store");
    const { AuthService } = require("../../services/auth.service");
    const auth = require("../../libs/auth.utils");
    await sendPhoneOtp(phone);
    stage = "check code";
    const supabaseUserId: string = await verifyPhoneOtp(phone, code);
    stage = "open profile";
    const accessToken: string | null = await getSupabaseAccessToken();
    if (!accessToken) throw new Error("no session after the code");
    const hint = (await fetchWalletReliably(supabaseUserId).catch(() => null))?.wallet?.ethAddress;
    const result = await AuthService.authenticateWithSupabaseSession(accessToken, hint);
    const address = String(result.user?.address || result.user?.walletAddress || "").toLowerCase();
    if (!result.token || !/^0x[0-9a-f]{40}$/.test(address)) throw new Error("no profile is linked to this sign-in");
    stage = "save session";
    await auth.setStoredSupabaseUserId(supabaseUserId);
    await auth.setAuthToken(result.token);
    if (result.refreshToken) await auth.setRefreshToken(result.refreshToken);
    if (result.expiresIn) await auth.setTokenExpiresAt(Date.now() + result.expiresIn * 1000);
    await auth.setAuthMethod("local", address);
    await auth.setAuthUser(result.user);
    await auth.setHasSeenAuth();
    return { username: result.user?.username, isNew: !!result.needsUsername };
  } catch (error) {
    // Letters only: a server message can quote the number it was sent.
    const why = String((error as Error)?.message ?? error).replace(/[0-9+]/g, "#").slice(0, 160);
    throw new Error(`phone sign-in stopped at "${stage}": ${why}`);
  }
}

/**
 * Signs the simulator in as the test account the script was given, so the
 * next launches open signed in: recovery words or a key, the way Import
 * wallet does, or a phone number with its code. The secret is read once and
 * removed from storage.
 */
async function runLogin(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "login" };
  const secret = await AsyncStorage.getItem(`${FLAG_KEY}.key`);
  await AsyncStorage.removeItem(`${FLAG_KEY}.key`);
  if (!secret) throw new Error("no test account key");
  if (secret.startsWith("{")) {
    const given = JSON.parse(secret) as { phone?: string; code?: string; secret?: string };
    if (given.phone && given.code) {
      extra.login = await signInWithPhoneCode(given.phone, given.code);
      extra.finishedAt = Date.now();
      await save(true);
      console.error("[perf-tour] signed in");
      return;
    }
    if (!given.secret) throw new Error("the test account has no usable sign-in");
    return importAndSignIn(given.secret);
  }
  return importAndSignIn(secret);
}

async function importAndSignIn(secret: string): Promise<void> {
  const { privateKeyFromImportSecret } = require("../../libs/wallet-core/derive");
  const { deriveAddressFromPrivateKey } = require("../../libs/wallet.utils");
  const { upsertLocalAccount } = require("../../libs/wallets.local");
  const { createLocalEip1193ProviderForChain } = require("../../services/localwallet.provider");
  const { setSigningProvider, setEoaSigningProvider } = require("../../libs/provider.registry");
  const { setAuthMethod, setAuthUser, setHasSeenAuth } = require("../../libs/auth.utils");
  const { AuthService } = require("../../services/auth.service");
  const { ChainId } = require("../../config/constants");
  const privateKey: string = privateKeyFromImportSecret(secret);
  const address = String(deriveAddressFromPrivateKey(privateKey)).toLowerCase();
  const provider = createLocalEip1193ProviderForChain(privateKey, ChainId.BASE_MAINNET);
  setSigningProvider(provider);
  setEoaSigningProvider(provider);
  await upsertLocalAccount({ address, privateKey });
  await setAuthMethod("local", address);
  const result = await AuthService.signInWithWallet(address, ChainId.BASE_MAINNET);
  await setAuthUser(result.user);
  await setHasSeenAuth();
  extra.login = { username: result.user?.username, isNew: !!result.needsUsername };
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] signed in");
}

async function run(): Promise<void> {
  const profiles = (await AsyncStorage.getItem(`${FLAG_KEY}.profiles`))?.split(",").filter(Boolean) ?? ["riftn", "araf"];
  const post = (await AsyncStorage.getItem(`${FLAG_KEY}.post`)) || "742";
  extra = { startedAt: Date.now() };

  // A first launch starts in the welcome flow; the walk is of the app itself.
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  // Let the first feed load and its warm-up work finish.
  await sleep(14000);
  extra.firstRoute = nav.getCurrentRoute()?.name;
  const signedIn = await hasSession();
  extra.signedIn = signedIn;

  // Bottom bar tabs: first visit builds the page, later visits should only show it.
  await measure("tab Explore (first)", tab(ScreenNames.Explore));
  await measure("tab Home (back)", tab(ScreenNames.Home));
  await measure("tab Explore", tab(ScreenNames.Explore));
  await measure("tab Home", tab(ScreenNames.Home));
  if (signedIn) {
    await measure("tab Messages (first)", tab(ScreenNames.DM));
    await measure("tab Home from Messages", tab(ScreenNames.Home));
    await measure("tab Messages", tab(ScreenNames.DM));
    await measure("tab Assistant (first)", tab(ScreenNames.AIChat));
    await measure("tab Messages from Assistant", tab(ScreenNames.DM));
    await measure("tab Assistant", tab(ScreenNames.AIChat));
    await measure("tab Home from Assistant", tab(ScreenNames.Home));
  } else {
    await measure("tab Explore 3", tab(ScreenNames.Explore));
    await measure("tab Home 3", tab(ScreenNames.Home));
  }

  // Home's own feed tabs.
  await measure("feed Shorts", feedTab("short"));
  await measure("feed Images", feedTab("feed-images"));
  await measure("feed Videos", feedTab("video"));
  await measure("feed All", feedTab("all"));

  // Profiles: open, back, the same one again, then a different one.
  const profileStep = { delayMs: PROFILE_LINK_DELAY_MS, watchMs: 2200 };
  await measure(`profile ${profiles[0]} open (first)`, openProfile(profiles[0]), profileStep);
  await measure("profile close", closeProfile());
  await measure(`profile ${profiles[0]} open`, openProfile(profiles[0]), profileStep);
  await measure("profile close 2", closeProfile());
  await measure(`profile ${profiles[1]} open`, openProfile(profiles[1]), profileStep);
  await measure("profile close 3", closeProfile());

  // Pages pushed on the stack, and Back.
  await measure("post open (first)", push(ScreenNames.FeedDetail, { tokenId: post }), { watchMs: 2200 });
  await measure("post back", back());
  await measure("post open", push(ScreenNames.FeedDetail, { tokenId: post }), { watchMs: 2200 });
  const second = signedIn ? ScreenNames.AccountSettings : ScreenNames.Leaderboard;
  await measure(`${signedIn ? "settings" : "leaderboard"} over post (two deep)`, push(second));
  await measure("back to post", back());
  await measure("back to Home", back());
  if (signedIn) {
    await measure("settings open", push(ScreenNames.AccountSettings));
    await measure("settings back", back());
  }
  await measure("search open (first)", push(ScreenNames.Search));
  await measure("search back", back());
  if (signedIn) {
    await measure("public chat open (first)", push(ScreenNames.LiveChat), { watchMs: 2200 });
    await measure("public chat back", back());
  }
  await measure("leaderboard open (first)", push(ScreenNames.Leaderboard), { watchMs: 2200 });
  await measure("leaderboard back", back());
  await measure("shorts viewer open", push(ScreenNames.ShortsViewer, {}), { watchMs: 2600 });
  if (nav.getCurrentRoute()?.name === ScreenNames.ShortsViewer) await measure("shorts viewer back", back());
  if (signedIn) {
    await measure("notifications open", push(ScreenNames.Notifications), { watchMs: 2200 });
    if (nav.getCurrentRoute()?.name === ScreenNames.Notifications) await measure("notifications back", back());
  }

  // The swipe back from the left edge has to be a real touch, so the script
  // performs it: the Leaderboard stays open until it has gone, or the wait
  // runs out.
  nav.navigate(ScreenNames.Leaderboard);
  await sleep(1500);
  const opened = nav.getCurrentRoute()?.name === ScreenNames.Leaderboard;
  let leftAt = 0;
  if (opened) {
    await AsyncStorage.setItem(SWIPE_KEY, "ready");
    const waitingSince = Date.now();
    while (!leftAt && Date.now() - waitingSince < 20000) {
      await sleep(50);
      if (nav.getCurrentRoute()?.name !== ScreenNames.Leaderboard) leftAt = Date.now();
    }
    await AsyncStorage.removeItem(SWIPE_KEY);
  }
  extra.swipeBack = { opened, went: leftAt > 0, leftAt };
  console.error(`[perf-tour] swipe back ${!opened ? "page did not open" : leftAt ? "went back" : "did nothing"}`);
  if (!leftAt) back()();

  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

/**
 * Every text box on screen, kept as boxes come and go, so the keyboard check
 * can put the cursor in one without knowing where it is drawn.
 */
const liveInputs: unknown[] = [];
const inputState = (require("react-native/Libraries/Components/TextInput/TextInputState").default ??
  require("react-native/Libraries/Components/TextInput/TextInputState")) as {
  registerInput(input: unknown): void;
  unregisterInput(input: unknown): void;
  focusTextInput(input: unknown): void;
};
{
  const { registerInput, unregisterInput } = inputState;
  inputState.registerInput = (input) => {
    if (!liveInputs.includes(input)) liveInputs.push(input);
    registerInput(input);
  };
  inputState.unregisterInput = (input) => {
    const at = liveInputs.indexOf(input);
    if (at >= 0) liveInputs.splice(at, 1);
    unregisterInput(input);
  };
}

/**
 * Can the keyboard always be closed. Explore: cursor in the search pill, a
 * real tap on its X. Then pages with number boxes: the cursor goes in each
 * box and the keyboard is pictured (a number pad has a bar with Done), and a
 * real drag of the page has to close it.
 */
async function runKeys(): Promise<void> {
  const { Keyboard } = require("react-native") as typeof import("react-native");
  extra = { startedAt: Date.now(), mode: "keys" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  const checks: Record<string, unknown>[] = [];
  extra.keys = checks;
  let asks = 0;
  const ask = async (request: string, waitMs: number) => {
    asks += 1;
    await AsyncStorage.setItem(SWIPE_KEY, request.replace("#", String(asks)));
    await sleep(waitMs);
  };
  const up = () => Keyboard.isVisible();
  const note = async (check: string, result: Record<string, unknown>) => {
    checks.push({ check, ...result });
    console.error(`[perf-tour] ${check}: ${JSON.stringify(result)}`);
    await save(false);
  };

  if (signedIn) {
    // A fresh sign-in is offered a profile photo, then notifications: "Not
    // now" on each, where they are drawn on this simulator.
    await sleep(14000);
    await ask("tap:not-now-photo-#:201:802", 9000);
    await ask("tap:not-now-notifications-#:201:649", 9000);
    await shot("0-asks-answered");
    await sleep(700);
  }

  // Explore, by its tab in the bottom bar.
  // The script acts on a request a few seconds after it is made (it looks
  // every two seconds, and idb takes a few more), so each one is given time.
  const hadBefore = new Set(liveInputs);
  nav.navigate(ScreenNames.Explore);
  await sleep(4000);
  const before = liveInputs.length;
  await shot("1-explore");
  await sleep(700);
  // The pill's own box when it can be told apart, else a tap on the pill.
  const pill = liveInputs.filter((input) => !hadBefore.has(input))[0];
  if (pill) inputState.focusTextInput(pill);
  else await ask("tap:explore-pill-#:150:87", 9000);
  await sleep(2500);
  const upAfterFocus = up();
  await shot("2-explore-keyboard-up");
  await sleep(700);
  await ask("type:explore-#:rif", 9000);
  await shot("3-explore-typed");
  await sleep(700);
  // The X sits before the sliders button at the end of the pill.
  await ask("tap:explore-x-#:346:87", 9000);
  const upAfterX = up();
  await shot("4-explore-after-x");
  await sleep(700);
  await note("explore-x", { inputs: before, upAfterFocus, upAfterX, route: nav.getCurrentRoute()?.name });
  // And a drag of the list under it closes it too.
  if (pill) inputState.focusTextInput(pill);
  else await ask("tap:explore-pill-#:150:87", 9000);
  await sleep(2500);
  const upAgain = up();
  await ask("drag:explore-#", 9000);
  await shot("5-explore-after-drag");
  await sleep(700);
  await note("explore-drag", { upAgain, upAfterDrag: up() });
  Keyboard.dismiss();
  nav.navigate(ScreenNames.Home);
  await sleep(1500);

  for (const page of ["Dao", "Bridge", "Launchpad", "Converter", "Usernames", "Accounts", "Dex"]) {
    const had = new Set(liveInputs);
    nav.navigate(page);
    await sleep(4000);
    const fresh = liveInputs.filter((input) => !had.has(input)).slice(0, 3);
    let index = 0;
    for (const input of fresh) {
      index += 1;
      inputState.focusTextInput(input);
      await sleep(2500);
      const shown = up();
      const height = Keyboard.metrics()?.height;
      await shot(`6-${page}-box-${index}`);
      await sleep(700);
      await ask(`drag:${page}-#`, 9000);
      await shot(`6-${page}-box-${index}-after-drag`);
      await sleep(700);
      await note(`${page}-box-${index}`, { shown, height, upAfterDrag: up(), route: nav.getCurrentRoute()?.name });
      Keyboard.dismiss();
      await sleep(600);
    }
    if (!fresh.length) await note(`${page}`, { boxes: 0, route: nav.getCurrentRoute()?.name });
    await backToTabs();
    nav.navigate(ScreenNames.Home);
    await sleep(1200);
  }
  if (signedIn) {
    // The post composer: its Post row has to sit on top of the keys.
    nav.navigate(ScreenNames.Upload);
    await sleep(6000);
    const upOnOpen = up();
    await shot("7-composer-keyboard-up");
    await sleep(700);
    Keyboard.dismiss();
    await sleep(1500);
    await shot("7-composer-keyboard-down");
    await sleep(700);
    await note("composer", { upOnOpen, height: Keyboard.metrics()?.height, route: nav.getCurrentRoute()?.name });

    // Scroll from the article body to the last setting in the same gesture area.
    // Capture the share preview and the settings above the docked toolbar.
    await ask("find:article-tab-#:Article", 9000);
    await ask("where:article-title-#:Article title", 4500);
    await ask("scroll:article-preview-#:-350", 5500);
    await shot("8-article-share-preview");
    await sleep(700);
    await ask("scroll:article-settings-#:-520", 5500);
    await shot("9-article-last-settings");
    await sleep(700);
    await ask("where:article-reply-setting-#:Who can reply", 4500);
    if (nav.getCurrentRoute()?.name === ScreenNames.Upload) nav.goBack();
    await sleep(2500);
  }
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

/**
 * Connect Wallet on the sign-in page opened from "Log in" (a native modal on
 * iPhone): a real tap on the button, then a picture. The wallet list has to
 * be on top of the page, not behind it.
 */
async function runWallet(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "wallet" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  // The app stack's sign-in page (the one "Log in" opens), not the first-run
  // stack's: on iPhone it is a native modal.
  (nav as any).navigate(ScreenNames.App, { screen: ScreenNames.SignIn });
  await sleep(6000);
  extra.route = nav.getCurrentRoute()?.name;
  const state = nav.getRootState();
  extra.stack = state?.routes[state.index]?.name;
  await shot("wallet-1-sign-in");
  await sleep(700);
  const reown = require("../../config/reown.config") as typeof import("../../config/reown.config");
  await AsyncStorage.setItem(SWIPE_KEY, "find:wallet-button:Wallet");
  await sleep(9000);
  extra.openByTap = !!reown.getAppKitInstance()?.getState().open;
  if (!extra.openByTap) {
    // The same call the button makes, when the tap could not find it.
    const kit = await reown.ensureAppKit();
    await kit?.open();
    await sleep(5000);
  }
  extra.pickerOpen = !!reown.getAppKitInstance()?.getState().open;
  // Held open for a while: the pictures are taken by the script outside the
  // app, a little after they are asked for.
  await shot("wallet-2-picker");
  await sleep(8000);
  await shot("wallet-3-picker-settled");
  await sleep(8000);
  // Left open: the script pictures the screen the moment this run reports
  // done (nav/wallet-<theme>-end.png), which is the dependable picture.
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] wallet ${JSON.stringify(extra)}`);
}

/**
 * The sign-in pop-ups a signed-out person meets: the sheet a like or follow
 * opens (raised here the way the feed's sign-in wall raises it), a real tap
 * on + in the tab bar, and the "Log in" page itself (a native modal on
 * iPhone). A picture of each.
 */
async function runLoginSheet(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "loginsheet" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const wall = require("../../libs/sign-in-wall") as typeof import("../../libs/sign-in-wall");
  wall.noteSignInWall({ signInRequired: true });
  await sleep(6000);
  await shot("login-1-like-sheet");
  await sleep(4000);
  // Closed by the Cancel button, the way a person would.
  await AsyncStorage.setItem(SWIPE_KEY, "find:cancel:Cancel");
  await sleep(8000);
  await AsyncStorage.setItem(SWIPE_KEY, "find:plus:Create");
  await sleep(8000);
  extra.plusRoute = nav.getCurrentRoute()?.name;
  await shot("login-2-plus");
  await sleep(4000);
  await AsyncStorage.setItem(SWIPE_KEY, "find:cancel2:Cancel");
  await sleep(6000);
  if (nav.getCurrentRoute()?.name === ScreenNames.SignIn) nav.goBack();
  await sleep(3000);
  (nav as any).navigate(ScreenNames.App, { screen: ScreenNames.SignIn });
  await sleep(7000);
  await shot("login-3-page");
  await sleep(6000);
  // A misspelled provider in the email box ("gmail.coms"): the field should
  // offer "Did you mean ...gmail.com?" instead of sending. Only on a build
  // that has the check, so main's run never sends a code to a dead address.
  const i18next = (require("i18next").default ?? require("i18next")) as { exists(key: string): boolean; t(key: string): string };
  extra.typoCheck = i18next.exists("loginModal.didYouMean");
  if (extra.typoCheck) {
    const field = liveInputs[liveInputs.length - 1];
    if (field) inputState.focusTextInput(field);
    await sleep(2000);
    await AsyncStorage.setItem(SWIPE_KEY, "type:email:alex@gmail.coms");
    await sleep(5000);
    await AsyncStorage.setItem(SWIPE_KEY, `find:emailgo:${i18next.t("loginModal.sendCode")}`);
    await sleep(6000);
    const { Keyboard } = require("react-native") as typeof import("react-native");
    Keyboard.dismiss();
    await sleep(2500);
    await shot("login-4-email-typo");
    await sleep(6000);
  }
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] loginsheet ${JSON.stringify(extra)}`);
}

/**
 * Player and When? checks: loop is off on a fresh start, a short that ends
 * moves on by itself, the Shorts "..." menu shows the player rows (loop
 * switch tapped on and off again), and the When? sheet's hour wheel turns
 * under a real finger flick. A picture of each step.
 */
async function runPlayer(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "player" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  let asks = 0;
  const ask = async (request: string, waitMs: number) => {
    asks += 1;
    await AsyncStorage.setItem(SWIPE_KEY, request.replace("#", String(asks)));
    await sleep(waitMs);
  };
  if (signedIn) {
    await sleep(14000);
    await ask("tap:not-now-photo-#:201:802", 9000);
    await ask("tap:not-now-notifications-#:201:649", 9000);
  }
  const prefs = require("../../libs/video-preferences") as typeof import("../../libs/video-preferences");
  extra.loopOnStart = prefs.getIsLooping();

  // Every player the app starts, so the one playing can be sent to its end.
  const players = new Map<object, number>();
  const calls: { wall: number; player: number; call: string }[] = [];
  extra.calls = calls;
  let nextId = 1;
  try {
    const probe = createVideoPlayer(null);
    const proto = Object.getPrototypeOf(probe) as Record<string, unknown>;
    for (const name of ["play", "replaceAsync", "replace"]) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      proto[name] = function (this: object, ...args: unknown[]) {
        if (!players.has(this)) players.set(this, nextId++);
        calls.push({ wall: Date.now(), player: players.get(this) ?? 0, call: name });
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
    }
    probe.release();
  } catch (error) {
    extra.patchError = String(error);
  }
  const playing = (): { player: { currentTime: number; duration: number; playing: boolean }; id: number } | undefined => {
    for (const [player, id] of players) {
      try {
        const p = player as { currentTime: number; duration: number; playing: boolean };
        if (p.playing && p.duration > 0) return { player: p, id };
      } catch { /* released */ }
    }
    return undefined;
  };

  nav.navigate(ScreenNames.ShortsViewer, {});
  await sleep(9000);
  extra.opened = nav.getCurrentRoute()?.name === ScreenNames.ShortsViewer;
  await shot("player-1-shorts");
  await sleep(700);
  const first = playing();
  extra.firstPlayer = first ? { id: first.id, duration: Math.round(first.player.duration) } : null;
  if (first) {
    const seekAt = Date.now();
    extra.seekAt = seekAt;
    try { first.player.currentTime = Math.max(0, first.player.duration - 1.5); } catch (error) { extra.seekError = String(error); }
    await sleep(9000);
    const next = playing();
    extra.afterEnd = next ? { id: next.id, at: Math.round(next.player.currentTime), duration: Math.round(next.player.duration) } : null;
    extra.callsAfterEnd = calls.filter((c) => c.wall >= seekAt).length;
    // Moved on: another player is playing, or the same one plays a clip of another length.
    extra.movedOn = !!next && (next.id !== first.id || Math.round(next.player.duration) !== Math.round(first.player.duration));
  }
  await shot("player-2-after-clip-end");
  await sleep(700);

  await ask("find:menu-#:More options", 9000);
  await shot("player-3-menu");
  await sleep(700);
  await ask("find:loop-on-#:Toggle loop", 7000);
  extra.loopAfterTap = prefs.getIsLooping();
  await shot("player-4-loop-on");
  await sleep(700);
  await ask("find:loop-off-#:Toggle loop", 7000);
  extra.loopAfterSecondTap = prefs.getIsLooping();
  // The dimmed space above the menu closes it.
  await ask("tap:menu-close-#:196:120", 7000);
  await shot("player-5-menu-closed");
  await sleep(700);
  if (nav.canGoBack()) nav.goBack();
  await sleep(3000);

  if (signedIn) {
    nav.navigate(ScreenNames.Upload);
    await sleep(6000);
    extra.uploadRoute = nav.getCurrentRoute()?.name;
    await ask("find:when-#:Schedule Post", 9000);
    await shot("player-6-when");
    await sleep(700);
    await ask("flick:hour-#:Hour:-120", 9000);
    await shot("player-7-hour-turned");
    await sleep(700);
    await ask("flick:minute-#:Minute:80", 9000);
    await shot("player-8-minute-turned");
    await sleep(700);
  }
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] player ${JSON.stringify({ ...extra, calls: calls.length })}`);
}

/**
 * The phone menu: Tabs (the default) on Main, another tab, the search row,
 * then the Sections and Folders layouts from Settings. A picture of each.
 */
async function runMenu(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "menu" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const prefs = require("../../hooks/useAppPrefs") as typeof import("../../hooks/useAppPrefs");
  prefs.setAppPref("menuLayout", "tabs");
  await AsyncStorage.setItem(SWIPE_KEY, "find:open:Open menu");
  await sleep(14000);
  await shot("menu-1-tabs-main");
  await sleep(4000);
  // A real finger dragged sideways across the tiles (the script pictures it
  // half way), then settled on the next group.
  await AsyncStorage.setItem(SWIPE_KEY, "hswipe:next");
  await sleep(6000);
  await shot("menu-2b-swiped");
  await sleep(3000);
  await AsyncStorage.setItem(SWIPE_KEY, "find:money:Money");
  await sleep(6000);
  await shot("menu-2-tabs-money");
  await sleep(4000);
  await AsyncStorage.setItem(SWIPE_KEY, "find:search:Search menu");
  await sleep(6000);
  await shot("menu-3-search");
  await sleep(4000);
  await AsyncStorage.setItem(SWIPE_KEY, "find:close:Clear search");
  await sleep(6000);
  await shot("menu-4-tabs-back");
  await sleep(3000);
  prefs.setAppPref("menuLayout", "sections");
  await sleep(4000);
  await shot("menu-5-sections");
  await sleep(4000);
  prefs.setAppPref("menuLayout", "folders");
  await sleep(4000);
  await shot("menu-6-folders");
  await sleep(4000);
  await AsyncStorage.setItem(SWIPE_KEY, "find:folder:Money");
  await sleep(6000);
  await shot("menu-7-folder-open");
  await sleep(6000);
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] menu ${JSON.stringify(extra)}`);
}


// --- speed: chats, typing, search and the busiest switches ---------------------

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The page on top, as measureScreen finds it. */
function topScreenFiber(): Fiber | null {
  const handle: Fiber | undefined = tourRoot?.__internalInstanceHandle ?? tourRoot?._internalFiberInstanceHandleDEV;
  if (!handle) return null;
  let top: Fiber = handle;
  while (top.return) top = top.return;
  const committed: Fiber = top.stateNode?.current ?? top;
  const routeKey = (nav.getCurrentRoute() as { key?: string } | undefined)?.key;
  if (!routeKey) return null;
  const queue: Fiber[] = [committed];
  for (let i = 0; i < queue.length && i < 200000; i++) {
    const f = queue[i];
    if (f.memoizedProps && typeof f.memoizedProps === "object" && f.memoizedProps.route?.key === routeKey && f.memoizedProps.navigation) return f;
    if (f.child) queue.push(f.child);
    if (f.sibling) queue.push(f.sibling);
  }
  return null;
}

type ListHandle = { scrollToOffset(p: { offset: number; animated?: boolean }): void; scrollToEnd(p?: { animated?: boolean }): void; props: { data?: unknown[]; horizontal?: boolean; inverted?: boolean } };

/** The longest up-and-down list on the page on top. */
function findList(): ListHandle | null {
  const screen = topScreenFiber();
  if (!screen) return null;
  let best: ListHandle | null = null;
  const queue: Fiber[] = screen.child ? [screen.child] : [];
  for (let i = 0; i < queue.length && i < 200000; i++) {
    const f = queue[i];
    const inst = f.stateNode;
    if (f.tag === 1 && inst && typeof inst.scrollToOffset === "function" && typeof inst.scrollToEnd === "function" && !inst.props?.horizontal) {
      const size = Array.isArray(inst.props?.data) ? inst.props.data.length : 0;
      const had = best && Array.isArray(best.props?.data) ? best.props.data!.length : -1;
      if (size > had) best = inst as ListHandle;
    }
    if (f.child) queue.push(f.child);
    if (f.sibling) queue.push(f.sibling);
  }
  return best;
}

/** What typing a character into this box calls, read fresh each time. */
function changeTextOf(input: unknown): ((text: string) => void) | null {
  const handle = (input as any)?.__internalInstanceHandle ?? (input as any)?._internalFiberInstanceHandleDEV;
  for (let f: Fiber | null = handle ?? null, i = 0; f && i < 14; f = f.return, i++) {
    const fn = f.memoizedProps?.onChangeText;
    if (typeof fn === "function") return fn as (text: string) => void;
  }
  return null;
}

const middle = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

/**
 * The things people do most, timed: bottom tabs, the chat list, a direct chat
 * and the public chat (open, reopen, scroll, type), the assistant's box,
 * search as you type, notifications, a post and a profile. Typing calls each
 * box's own change handler one character at a time and times how long the app
 * takes to draw the next frame; nothing is ever sent.
 */
async function runSpeed(): Promise<void> {
  const { Keyboard } = require("react-native") as typeof import("react-native");
  extra = { startedAt: Date.now(), mode: "speed" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);
  const signedIn = await hasSession();
  extra.signedIn = signedIn;

  // Elements created (how much of the screen is drawn again) and when the last one was.
  let created = 0;
  let lastCreatedAt = 0;
  // The same count by what was created, so a step can name what it drew most.
  let kinds = new Map<string, number>();
  const typeName = (type: unknown): string => {
    if (typeof type === "string") return type;
    const t = type as { displayName?: string; name?: string; type?: { displayName?: string; name?: string }; render?: { displayName?: string; name?: string } } | null;
    return t?.displayName || t?.name || t?.type?.displayName || t?.type?.name || t?.render?.displayName || t?.render?.name || "other";
  };
  const topKinds = () => [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, n]) => `${name} ${n}`);
  // Which component's render created them. Only a bundle built without
  // minifying keeps the names (the workflow's minify=false); each element then
  // costs a stack read, so the times of such a run are not to be compared.
  const NAMED = (function ownerProbe() {}).name === "ownerProbe";
  let owners = new Map<string, number>();
  const INSIDE = /^(ownerOf|counted|jsx|jsxs|jsxDEV|anonymous|renderWithHooks|renderWithHooksAgain|updateFunctionComponent|updateForwardRef|updateMemoComponent|updateSimpleMemoComponent|beginWork|performUnitOfWork|workLoopSync|map|forEach|apply|call)?$/;
  const ownerOf = (): string => {
    const lines = (new Error().stack || "").split("\n");
    for (let i = 1; i < Math.min(lines.length, 9); i++) {
      const name = /^\s*at ([^\s(]+)/.exec(lines[i])?.[1] ?? "";
      if (/^(renderWithHooks|updateFunctionComponent|beginWork)/.test(name)) break;
      if (!INSIDE.test(name)) return name;
    }
    return "unnamed";
  };
  const topOwners = () => [...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, n]) => `${name} ${n}`);
  const runtime = require("../../libs/jsx/jsx-runtime") as Record<string, (...args: unknown[]) => unknown>;
  for (const key of ["jsx", "jsxs"]) {
    const original = runtime[key];
    runtime[key] = function counted(...args: unknown[]) {
      created += 1;
      lastCreatedAt = now();
      const name = typeName(args[0]);
      kinds.set(name, (kinds.get(name) ?? 0) + 1);
      if (NAMED) {
        const owner = ownerOf();
        owners.set(owner, (owners.get(owner) ?? 0) + 1);
      }
      return original(...args);
    };
  }
  // The app's own render timings (libs/perfTrace), kept instead of logged.
  let perfLines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[perf] ")) {
      perfLines.push(args[0].slice(7));
      return;
    }
    warn(...(args as []));
  };
  try {
    (require("../../libs/perfTrace") as { setPerfTrace(on: boolean): void }).setPerfTrace(true);
  } catch {
    // Timings by frame still work without it.
  }
  const probes = (lines: string[]) => {
    const by = new Map<string, { n: number; max: number }>();
    let tasks = 0;
    let taskMs = 0;
    let longest = 0;
    let stalls = 0;
    for (const line of lines) {
      const task = /^task (\d+)ms/.exec(line);
      if (task) {
        tasks += 1;
        taskMs += Number(task[1]);
        longest = Math.max(longest, Number(task[1]));
        for (const part of line.split(" | ").slice(1)) {
          const m = /^(.+) (\d+)x (\d+)ms$/.exec(part);
          if (!m) continue;
          const entry = by.get(m[1]) ?? { n: 0, max: 0 };
          entry.n += Number(m[2]);
          entry.max = Math.max(entry.max, Number(m[3]));
          by.set(m[1], entry);
        }
      }
      const stall = /^js blocked (\d+)ms/.exec(line);
      if (stall) stalls += Number(stall[1]);
    }
    return { tasks, taskMs, longest, stalls, top: [...by.entries()].sort((a, b) => b[1].max - a[1].max).slice(0, 8).map(([label, e]) => `${label} ${e.n}x ${e.max}ms`) };
  };

  const detail: Record<string, unknown> = {};
  extra.detail = detail;
  const timed = async (step: string, action: () => void, opts: { watchMs?: number; delayMs?: number; restMs?: number } = {}) => {
    created = 0;
    perfLines = [];
    let origin = 0;
    await measure(step, () => {
      origin = now() + (opts.delayMs ?? 0);
      created = 0;
      kinds = new Map();
      owners = new Map();
      action();
    }, { restMs: 500, ...opts });
    detail[step] = { elements: created, lastDrawMs: Math.max(0, Math.round(lastCreatedAt - origin)), kinds: topKinds(), ...(NAMED ? { owners: topOwners() } : {}), ...probes(perfLines) };
    await save(false);
  };

  /** One character at a time through the box's own handler; the box is left empty. */
  const typeInto = async (step: string, input: unknown, text: string) => {
    if (!changeTextOf(input)) {
      detail[step] = { error: "no text box found" };
      return;
    }
    perfLines = [];
    kinds = new Map();
    owners = new Map();
    const perKey: number[] = [];
    const perKeyElements: number[] = [];
    for (let i = 1; i <= text.length; i++) {
      const change = changeTextOf(input);
      if (!change) break;
      await nextFrame();
      const before = created;
      const start = now();
      change(text.slice(0, i));
      await nextFrame();
      await nextFrame();
      perKey.push(now() - start);
      perKeyElements.push(created - before);
      await sleep(140);
    }
    const lines = perfLines;
    const drawn = topKinds();
    const builtBy = NAMED ? topOwners() : undefined;
    await sleep(600);
    changeTextOf(input)?.("");
    await sleep(500);
    detail[step] = {
      keys: perKey.length,
      keyMs: middle(perKey),
      keyWorstMs: Math.round(Math.max(0, ...perKey)),
      keyElements: middle(perKeyElements),
      keyElementsWorst: Math.max(0, ...perKeyElements),
      kinds: drawn,
      ...(builtBy ? { owners: builtBy } : {}),
      ...probes(lines),
    };
    console.error(`[perf-tour] ${step} ${JSON.stringify(detail[step])}`);
    await save(false);
  };

  /** The newest text box that was not there before `had`. */
  const newInput = (had: Set<unknown>) => liveInputs.filter((input) => !had.has(input)).pop();

  /** Down the list and back, drawn by the app as it goes. */
  const scrollList = async (step: string) => {
    const list = findList();
    if (!list) {
      detail[step] = { error: "no list found" };
      return;
    }
    const rows = Array.isArray(list.props.data) ? list.props.data.length : 0;
    const inverted = !!list.props.inverted;
    // The public chat opens at its end with the newest line: up to the oldest
    // loaded line and back. Every other list goes a few screens down and back.
    const fromEnd = !inverted && step.startsWith("public chat");
    await timed(`${step} away`, () => (fromEnd ? list.scrollToOffset({ offset: 0, animated: true }) : list.scrollToOffset({ offset: 2400, animated: true })), { watchMs: 2600 });
    await timed(`${step} back`, () => (fromEnd ? list.scrollToEnd({ animated: true }) : list.scrollToOffset({ offset: 0, animated: true })), { watchMs: 2600 });
    (detail[`${step} away`] as Record<string, unknown>).rows = rows;
  };

  // Everything once first, so a repeat visit is what gets timed afterwards.
  for (const name of [ScreenNames.Explore, ...(signedIn ? [ScreenNames.DM, ScreenNames.AIChat] : []), ScreenNames.Home]) {
    tab(name)();
    await sleep(2500);
  }

  await timed("idle on Home", () => undefined);
  await timed("tab Explore", tab(ScreenNames.Explore));
  await timed("tab Home", tab(ScreenNames.Home));
  if (signedIn) {
    await timed("tab Messages", tab(ScreenNames.DM));
    await scrollList("chat list scroll");
    await timed("tab Assistant", tab(ScreenNames.AIChat));
    await timed("tab Messages again", tab(ScreenNames.DM));

    // The direct chat with the most history on this account.
    const dm = require("../../store/dm.store") as {
      dmState: { contactsById: Record<string, unknown>; messagesByConversation: Record<string, unknown[]> };
      dmActions: { addOptimistic: (id: string, line: unknown) => void; removeOptimistic: (id: string, tempId: string) => void };
    };
    const ids = Object.keys(dm.dmState.contactsById).sort((a, b) => (dm.dmState.messagesByConversation[b]?.length ?? 0) - (dm.dmState.messagesByConversation[a]?.length ?? 0));
    extra.chats = ids.length;
    if (ids.length) {
      const open = push(ScreenNames.Chat, { conversationId: ids[0], title: "Chat" });
      let had = new Set(liveInputs);
      await timed("chat open (first)", open, { watchMs: 2600 });
      extra.chatLines = dm.dmState.messagesByConversation[ids[0]]?.length ?? 0;
      await timed("chat back", back());
      had = new Set(liveInputs);
      await timed("chat open", open, { watchMs: 2600 });
      await scrollList("chat scroll");
      const box = newInput(had);
      await typeInto("chat typing", box, "hello there, how are you");
      // The first thing a send does: the line appears in the chat before the
      // server has it. The same store call, with nothing queued or sent, and
      // the line is taken away again.
      const tempId = `temp-tour-${Date.now()}`;
      const line = { _id: tempId, _optimistic: true, _tempId: tempId, conversation: ids[0], sender: "me", author: "me", content: "hello there, how are you", msgType: "msg", tipAmount: null, paymentStatus: null, createdAt: new Date().toISOString() };
      await timed("chat own line appears", () => dm.dmActions.addOptimistic(ids[0], line), { watchMs: 1200 });
      await timed("chat own line removed", () => dm.dmActions.removeOptimistic(ids[0], tempId), { watchMs: 1200 });
      Keyboard.dismiss();
      await timed("chat back 2", back());
    }

    // The public chat: the longest chat there is, and open to everyone.
    let had = new Set(liveInputs);
    await timed("public chat open (first)", push(ScreenNames.LiveChat), { watchMs: 3000 });
    await timed("public chat back", back());
    had = new Set(liveInputs);
    await timed("public chat open", push(ScreenNames.LiveChat), { watchMs: 3000 });
    await shot("speed-public-chat");
    await scrollList("public chat scroll");
    await typeInto("public chat typing", newInput(had), "hello there, how are you");
    Keyboard.dismiss();
    await timed("public chat back 2", back());
    await backToTabs();

    // The assistant's box.
    had = new Set(liveInputs);
    await timed("tab Assistant 2", tab(ScreenNames.AIChat));
    await typeInto("assistant typing", newInput(had) ?? liveInputs[liveInputs.length - 1], "hello there, how are you");
    Keyboard.dismiss();
    await timed("tab Home from Assistant", tab(ScreenNames.Home));
  }

  // Search as you type: each key, then how long until the results stop drawing.
  {
    const had = new Set(liveInputs);
    await timed("search open", push(ScreenNames.Search), { watchMs: 2200 });
    const box = newInput(had);
    const change = changeTextOf(box);
    if (change) {
      perfLines = [];
      const perKey: number[] = [];
      const perKeyElements: number[] = [];
      const word = "riftn";
      let typedAt = 0;
      for (let i = 1; i <= word.length; i++) {
        await nextFrame();
        const before = created;
        const start = now();
        changeTextOf(box)?.(word.slice(0, i));
        await nextFrame();
        await nextFrame();
        perKey.push(now() - start);
        perKeyElements.push(created - before);
        typedAt = now();
        await sleep(140);
      }
      // Something is in when nothing new has been drawn for 1.2 seconds:
      // first the suggestions under the box, then the results of the search
      // itself (the keyboard's search key).
      const quietAfter = async (from: number): Promise<number> => {
        for (let waited = 0; waited < 9000; waited += 100) {
          await sleep(100);
          if (lastCreatedAt > from && now() - lastCreatedAt > 1200) return Math.round(lastCreatedAt - from);
        }
        return 0;
      };
      const suggestionsMs = await quietAfter(typedAt);
      const typingLines = perfLines;
      let resultsMs = 0;
      let submit: ((event: unknown) => void) | null = null;
      const handle = (box as any)?.__internalInstanceHandle ?? (box as any)?._internalFiberInstanceHandleDEV;
      for (let f: Fiber | null = handle ?? null, i = 0; f && i < 14 && !submit; f = f.return, i++) {
        if (typeof f.memoizedProps?.onSubmitEditing === "function") submit = f.memoizedProps.onSubmitEditing;
      }
      if (submit) {
        const submittedAt = now();
        created = 0;
        submit({ nativeEvent: { text: word } });
        resultsMs = await quietAfter(submittedAt);
        detail["search results"] = { elements: created, resultsMs };
      }
      detail["search typing"] = { keys: perKey.length, keyMs: middle(perKey), keyWorstMs: Math.round(Math.max(0, ...perKey)), keyElements: middle(perKeyElements), keyElementsWorst: Math.max(0, ...perKeyElements), suggestionsMs, resultsMs, ...probes(typingLines) };
      console.error(`[perf-tour] search typing ${JSON.stringify(detail["search typing"])}`);
      await shot("speed-search-results");
      await sleep(800);
      await scrollList("search results scroll");
      changeTextOf(box)?.("");
      await sleep(400);
    } else {
      detail["search typing"] = { error: "no text box found" };
    }
    Keyboard.dismiss();
    await timed("search back", back());
    await backToTabs();
  }

  if (signedIn) {
    await timed("notifications open (first)", push(ScreenNames.Notifications), { watchMs: 2400 });
    if (nav.getCurrentRoute()?.name === ScreenNames.Notifications) await timed("notifications back", back());
    await timed("notifications open", push(ScreenNames.Notifications), { watchMs: 2400 });
    if (nav.getCurrentRoute()?.name === ScreenNames.Notifications) await timed("notifications back 2", back());
    await backToTabs();
  }
  const post = (await AsyncStorage.getItem(`${FLAG_KEY}.post`)) || "742";
  await timed("post open (first)", push(ScreenNames.FeedDetail, { tokenId: post }), { watchMs: 2400 });
  await timed("post back", back());
  const beforePost = new Set(liveInputs);
  await timed("post open", push(ScreenNames.FeedDetail, { tokenId: post }), { watchMs: 2400 });
  // The comment box under a post. Nothing is posted.
  if (signedIn) {
    await typeInto("post comment typing", newInput(beforePost), "hello there, how are you");
    Keyboard.dismiss();
  }
  await timed("post back 2", back());
  const profileStep = { delayMs: PROFILE_LINK_DELAY_MS, watchMs: 2400 };
  await timed("profile open (first)", openProfile("riftn"), profileStep);
  await timed("profile close", closeProfile());
  await timed("profile open", openProfile("riftn"), profileStep);
  await timed("profile close 2", closeProfile());
  await timed("feed Shorts", feedTab("short"));
  await timed("feed All", feedTab("all"));
  if (signedIn) {
    const beforeUpload = new Set(liveInputs);
    await timed("new post open", push(ScreenNames.Upload), { watchMs: 2400 });
    // The caption box of a new post. Nothing is posted and the box is left empty.
    await typeInto("new post typing", newInput(beforeUpload), "hello there, how are you");
    Keyboard.dismiss();
    if (nav.getCurrentRoute()?.name === ScreenNames.Upload) await timed("new post back", back());
    await backToTabs();
  }

  console.warn = warn;
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

/**
 * Reactions landing in public chat: opens the public chat and plays scripted
 * reaction updates through the chat's own socket handler (the same path a
 * real reaction takes), on the newest lines. Filmed by the harness; the
 * style comes from dehub.perfTour.reactStyle (fly when unset).
 */
type ChatLine = import("../../services/livechat.service").LiveChatMessageData;
type ChatTap = (update: (prev: ChatLine[]) => ChatLine[]) => void;
/** Each mounted live chat (hooks/useLiveChat) adds its line updater here. */
const chatTaps = new Set<ChatTap>();
(globalThis as { __liveChatTaps?: Set<ChatTap> }).__liveChatTaps = chatTaps;

/**
 * Reactions landing in a live's chat, signed out: opens a live, adds three
 * chat lines, then plays reactions on them through the chat's own state, the
 * way socket updates arrive. Filmed by the harness. The style comes from
 * dehub.perfTour.reactStyle (fly when unset).
 */
async function runReactions(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "reactions" };
  const prefs = require("../../hooks/useAppPrefs") as typeof import("../../hooks/useAppPrefs");
  const style = (await AsyncStorage.getItem("dehub.perfTour.reactStyle")) || "fly";
  prefs.setAppPref("chatReactionStyle", style as never);
  extra.style = style;
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(8000);
  let streamId = "";
  try {
    const { getLiveVideos } = require("../../services/live.service") as { getLiveVideos(p: object): Promise<any> };
    const res = await getLiveVideos({ unit: 50, sortMode: "recent" });
    const rows: any[] = Array.isArray(res) ? res : Array.isArray(res?.result) ? res.result : [];
    const onAir = rows.find((r) => r?.status === "live" || r?.isLive) ?? rows[0];
    streamId = String(onAir?._id ?? onAir?.id ?? "");
  } catch (error) {
    console.error(`[perf-tour] live list failed ${String(error)}`);
  }
  extra.streamId = streamId;
  nav.navigate(ScreenNames.LiveViewer, { streamId });
  await sleep(10000);
  extra.taps = chatTaps.size;
  const fake = (n: number) => `0x${String(n).repeat(40).slice(0, 40)}`;
  const people = [
    { address: fake(7), username: "xluna", displayName: "Luna" },
    { address: fake(8), username: "ellaverse", displayName: "Ella Verse" },
    { address: fake(9), username: "deepwater", displayName: "Deep Water" },
  ];
  const texts = ["gm chat, who is watching tonight?", "this set is unreal", "turn it up"];
  const ids = texts.map((_, i) => `tour-line-${Date.now()}-${i}`);
  const at = Date.now();
  const lines: ChatLine[] = texts.map((content, i) => ({
    _id: ids[i], roomId: "tour", sender: people[i], senderAddress: people[i].address, content,
    messageType: "text", reactions: i === 0 ? { "🔥": [fake(1), fake(2)] } : {},
    createdAt: new Date(at - (3 - i) * 1000).toISOString(),
  }) as unknown as ChatLine);
  for (const tap of chatTaps) tap((prev) => [...prev.filter((m) => !m._id.startsWith("tour-line-")), ...lines]);
  await sleep(2500);
  await shot("reactions-0-lines");
  const add = (line: number, emoji: string, who: string) => {
    const id = ids[line];
    for (const tap of chatTaps) tap((prev) => prev.map((m) => {
      if (m._id !== id) return m;
      const cur = (m.reactions ?? {}) as Record<string, string[]>;
      return { ...m, reactions: { ...cur, [emoji]: [...(cur[emoji] ?? []), who] } } as ChatLine;
    }));
  };
  const beats: Array<[number, number, string, string]> = [
    // The 100 first: it draws itself out and back in, so a play cut short shows.
    [800, 0, "💯", fake(3)],
    [3000, 1, "❤️", fake(4)],
    [5000, 2, "😂", fake(5)],
    [5350, 2, "😂", fake(6)],
    [5700, 2, "😂", fake(1)],
    [7600, 1, "🚀", fake(2)],
    [8600, 0, "🔥", fake(4)],
  ];
  const t0 = Date.now();
  for (const [ms, line, emoji, who] of beats) {
    const wait = t0 + ms - Date.now();
    if (wait > 0) await sleep(wait);
    add(line, emoji, who);
    await sleep(350);
    await shot(`reactions-${ms}-landing`);
  }
  await sleep(2500);
  await shot("reactions-9-after");
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] reactions done: style ${style}, stream ${streamId || "none"}, taps ${chatTaps.size}`);
}

/**
 * Reactions waiting in the Messages list: opens Messages, then puts unread
 * reactions on the Public Chat row through the list's own settings cache (the
 * same data a real reaction brings), adding more so the arrival plays on the
 * row. Filmed by the harness. Style from dehub.perfTour.reactStyle (fly when unset).
 */
async function runRowReactions(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "rowreactions" };
  const prefs = require("../../hooks/useAppPrefs") as typeof import("../../hooks/useAppPrefs");
  const { queryClient } = require("../../config/queryClient") as typeof import("../../config/queryClient");
  const { PUBLIC_CHAT_PREF_ID } = require("../../services/dm/dm.api") as typeof import("../../services/dm/dm.api");
  type Pref = import("../../services/dm/dm.api").ChatPref;
  const style = (await AsyncStorage.getItem("dehub.perfTour.reactStyle")) || "fly";
  prefs.setAppPref("chatReactionStyle", style as never);
  extra.style = style;
  extra.signedIn = await hasSession();
  await sleep(6000);
  await tab(ScreenNames.DM)();
  await sleep(6000);
  extra.route = nav.getCurrentRoute()?.name;
  await shot("rowreactions-0-list");
  const KEY = ["dm-chat-prefs"];
  const put = (total: number, emojis: Array<[string, number]>, last: string) => {
    const reactions = {
      total,
      emojis: emojis.map(([emoji, count]) => ({ emoji, count })),
      last: { emoji: last, by: "0x7777777777777777777777777777777777777777", name: "Luna", messageId: "tour-row", at: new Date().toISOString() },
    };
    queryClient.setQueryData<Pref[]>(KEY, (cur = []) => [
      ...cur.filter((p) => p.conversationId !== PUBLIC_CHAT_PREF_ID),
      { conversationId: PUBLIC_CHAT_PREF_ID, pinnedAt: null, archivedAt: null, mutedUntil: null, markedUnread: false, reactions } as Pref,
    ]);
  };
  const beats: Array<[number, number, Array<[string, number]>, string]> = [
    [0, 1, [["💯", 1]], "💯"],
    [3000, 2, [["💯", 2]], "💯"],
    [6000, 3, [["😂", 1], ["💯", 2]], "😂"],
    [9000, 5, [["🔥", 2], ["😂", 1], ["💯", 2]], "🔥"],
  ];
  const t0 = Date.now();
  for (const [ms, total, emojis, last] of beats) {
    const wait = t0 + ms - Date.now();
    if (wait > 0) await sleep(wait);
    put(total, emojis, last);
    await sleep(400);
    await shot(`rowreactions-${ms}-landing`);
  }
  await sleep(3000);
  await shot("rowreactions-9-after");
  queryClient.setQueryData<Pref[]>(KEY, (cur = []) => cur.filter((p) => p.conversationId !== PUBLIC_CHAT_PREF_ID));
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] rowreactions done: style ${style}, route ${String(extra.route)}`);
}

/**
 * Moments (24-hour stories): the Glass Shelf on Home with sample moments
 * put in through the shelf's own query cache, then the viewer on the first
 * person, then the creator's first screen. Pictured per theme by the harness.
 */
async function runMoments(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "moments" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const { queryClient } = require("../../config/queryClient") as typeof import("../../config/queryClient");
  const store = require("../../store/stories.store") as typeof import("../../store/stories.store");
  const now = Date.now();
  const iso = (min: number) => new Date(now - min * 60000).toISOString();
  const pic = (n: number) => `https://picsum.photos/id/${n}/1080/1920`;
  const people: Array<[string, string, number[]]> = [
    ["araf", "Araf", [1018, 1015]],
    ["aaron", "Aaron", [1025]],
    ["jesse", "Jesse C", [1036, 1043]],
    ["moggel", "Moggel", [1050]],
    ["nova", "Nova", [1062]],
  ];
  let id = 1;
  const shelf = people.map(([username, displayName, pics], i) => {
    const address = `0x${String(i + 1).repeat(40).slice(0, 40)}`;
    return {
      author: { address, username, displayName, avatarImageUrl: pic(64 + i) },
      own: false,
      following: true,
      seen: i >= 3,
      latestAt: iso((i + 1) * 30),
      items: pics.map((n, k) => ({
        id: String(id++).padStart(24, "0"),
        address,
        type: "photo" as const,
        status: "ready" as const,
        mediaUrl: pic(n),
        posterUrl: pic(n),
        overlayUrl: null,
        width: 1080,
        height: 1920,
        durationMs: 5000,
        muted: false,
        caption: i === 0 && k === 0 ? "Sunset run" : null,
        mentions: [],
        song: null,
        audience: "everyone" as const,
        allowReplies: true,
        createdAt: iso((i + 1) * 30 + k * 5),
        expiresAt: new Date(now + 20 * 3600000).toISOString(),
        viewed: i >= 3,
        liked: false,
      })),
    };
  });
  queryClient.setQueriesData({ queryKey: ["story-shelf"] }, { shelf, signedIn: false });
  queryClient.setQueryData(["story-shelf", "", false], { shelf, signedIn: false, askedHosts: "" });
  await sleep(4000);
  await shot("moments-0-shelf");
  await sleep(3000);
  store.openStoryViewer(shelf as never, 0);
  await sleep(3500);
  await shot("moments-1-viewer");
  await sleep(3000);
  store.closeStoryViewer();
  await sleep(1500);
  store.openStoryCreator();
  await sleep(3000);
  await shot("moments-2-creator");
  await sleep(3000);
  store.closeStoryCreator();
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] moments done");
}

/**
 * Profile tabs: real finger taps on a profile's tab bar, with the page at the
 * top, part way down and with the bar pinned, filmed. Before and after each
 * tap the script reads where the tab bar is drawn ("where:"), so a page that
 * jumps on a tab switch shows as a moved bar. Signed in it walks your own
 * profile; signed out, araf's.
 */
async function runProfileTabs(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "profiletabs" };
  // The profile reports each switch and where each tab list is put (main's
  // code has neither; then nothing is logged).
  const g = globalThis as { __profileTabSwitch?: (info: unknown) => void; __profilePaneOffset?: (y: number, seq: number) => void };
  g.__profileTabSwitch = (info) => console.error(`[perf-tour] switch ${JSON.stringify(info)}`);
  g.__profilePaneOffset = (y, seq) => console.error(`[perf-tour] pane offset ${Math.round(y * 1000) / 1000} seq ${seq}`);
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  if (signedIn) tab(ScreenNames.ProfileTab)();
  else emitProfileDeepLink((await AsyncStorage.getItem(`${FLAG_KEY}.profile`)) || "araf");
  await sleep(12000);
  extra.opened = nav.getCurrentRoute()?.name;
  const steps: { step: string; worstMs: number; slowFrames: number; wall: number }[] = [];
  extra.tabSteps = steps;
  let n = 0;
  const ask = async (request: string, waitMs: number) => {
    await AsyncStorage.setItem(SWIPE_KEY, request);
    await sleep(waitMs);
  };
  const where = async (label: string) => {
    n += 1;
    await ask(`where:${String(n).padStart(2, "0")}-${label}:${label}`, 4500);
  };
  const act = async (step: string, request: string) => {
    n += 1;
    const name = `${String(n).padStart(2, "0")}-${step}`;
    const stamps: number[] = [];
    let alive = true;
    const loop = () => {
      if (!alive) return;
      stamps.push(now());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const wall = Date.now();
    await ask(request.replace("@", name), 7000);
    alive = false;
    let worst = 0;
    let slow = 0;
    for (let i = 1; i < stamps.length; i++) {
      const gap = stamps[i] - stamps[i - 1];
      if (gap > worst) worst = gap;
      if (gap > FRAME_MS * 2) slow += 1;
    }
    steps.push({ step: name, worstMs: Math.round(worst), slowFrames: slow, wall });
    console.error(`[perf-tour] ${name}: worst frame ${Math.round(worst)} ms, ${slow} slow`);
    await shot(name);
    await sleep(700);
    await save(false);
  };
  await shot("00-open");
  await sleep(700);
  await where("All");
  await act("scroll-part", "scroll:@:-260");
  await where("All");
  await act("tap-images", "find:@:Images");
  await where("Images");
  await act("tap-videos", "find:@:Videos");
  await where("Videos");
  await act("tap-all", "find:@:All");
  await where("All");
  await act("scroll-pin", "scroll:@:-700");
  await where("All");
  await act("tap-images-pinned", "find:@:Images");
  await where("Images");
  await act("tap-posts-pinned", "find:@:Posts");
  await where("Posts");
  await act("tap-all-pinned", "find:@:All");
  await where("All");
  await act("scroll-top", "scroll:@:690");
  await act("scroll-top-2", "scroll:@:690");
  await act("tap-videos-top", "find:@:Videos");
  await where("Videos");
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] profiletabs done: opened ${String(extra.opened)}, signed in ${String(signedIn)}`);
}

/**
 * Bars after Back: scroll Home down until its header and the bottom nav
 * hide, open something, scroll it, go back with a real finger swipe, and
 * picture what Home looks like. Three ways in: a profile from the feed, a
 * pushed page (Leaderboard), and a tab switch (Search, then Home).
 */
async function runBarsBack(): Promise<void> {
  extra = { startedAt: Date.now(), mode: "barsback" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(14000);
  const steps: { step: string; route: string | undefined }[] = [];
  extra.barSteps = steps;
  let n = 0;
  const step = async (label: string, request = "", waitMs = 4000) => {
    n += 1;
    const name = `${String(n).padStart(2, "0")}-${label}`;
    if (request) {
      await AsyncStorage.setItem(SWIPE_KEY, request.replace("@", name));
      await sleep(waitMs);
    }
    await sleep(900);
    await shot(name);
    await sleep(900);
    steps.push({ step: name, route: nav.getCurrentRoute()?.name });
    console.error(`[perf-tour] ${name}: on ${nav.getCurrentRoute()?.name}`);
    await save(false);
  };
  const scrollHome = async (label: string) => {
    await step(`${label}-scroll-1`, "scroll:@:-520");
    await step(`${label}-scroll-2`, "scroll:@:-520");
  };
  await step("home-top");
  // 1. A profile opened from the feed, swiped back.
  await scrollHome("home");
  emitProfileDeepLink((await AsyncStorage.getItem(`${FLAG_KEY}.profile`)) || "araf");
  await sleep(8000);
  await step("profile-open");
  await step("profile-scroll", "scroll:@:-520");
  await step("profile-scroll-2", "scroll:@:-520");
  await step("profile-swiped-back", "swipe:@", 5000);
  await sleep(1200);
  await step("home-after-profile");
  // 2. A pushed page, swiped back.
  await backToTabs();
  await scrollHome("home-again");
  nav.navigate(ScreenNames.Leaderboard);
  await sleep(4000);
  await step("leaderboard-open");
  await step("leaderboard-scroll", "scroll:@:-520");
  await step("leaderboard-swiped-back", "swipe:@", 5000);
  await sleep(1200);
  await step("home-after-leaderboard");
  // 3. A tab switch away and back.
  await scrollHome("home-third");
  tab(ScreenNames.Explore)();
  await sleep(3500);
  await step("search-tab");
  tab(ScreenNames.Home)();
  await sleep(2500);
  await step("home-after-tab");
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] barsback done");
}

/**
 * Typing on a live (concept "B Fold in"): opens a live, puts the cursor in the
 * chat box (the buttons fold into it), types a long line (the box grows),
 * flies a copy of a line into the chat, erases the words (the box shrinks)
 * and closes the keyboard (the buttons come back). Nothing is ever sent.
 * Use account=review: signed out the box is closed.
 */
async function runLiveChat(): Promise<void> {
  const { Keyboard } = require("react-native") as typeof import("react-native");
  extra = { startedAt: Date.now(), mode: "livechat" };
  const root = nav.getRootState();
  if (root?.routes[root.index]?.name !== ScreenNames.App) {
    nav.navigate(ScreenNames.App);
    await sleep(1500);
  }
  await sleep(12000);
  const signedIn = await hasSession();
  extra.signedIn = signedIn;
  let asks = 0;
  const ask = async (request: string, waitMs: number) => {
    asks += 1;
    await AsyncStorage.setItem(SWIPE_KEY, request.replace("#", String(asks)));
    await sleep(waitMs);
  };
  if (signedIn) {
    await sleep(14000);
    await ask("tap:not-now-photo-#:201:802", 9000);
    await ask("tap:not-now-notifications-#:201:649", 9000);
  }
  let streamId = "";
  try {
    const { getLiveVideos } = require("../../services/live.service") as { getLiveVideos(p: object): Promise<any> };
    const res = await getLiveVideos({ unit: 50, sortMode: "recent" });
    const rows: any[] = Array.isArray(res) ? res : Array.isArray(res?.result) ? res.result : [];
    const onAir = rows.find((r) => r?.status === "live" || r?.isLive) ?? rows[0];
    streamId = String(onAir?._id ?? onAir?.id ?? "");
  } catch (error) {
    console.error(`[perf-tour] live list failed ${String(error)}`);
  }
  extra.streamId = streamId;
  const hadBefore = new Set(liveInputs);
  nav.navigate(ScreenNames.LiveViewer, { streamId });
  await sleep(12000);
  await shot("livechat-1-idle");
  await sleep(3500);
  const box = liveInputs.filter((input) => !hadBefore.has(input)).pop() as
    | { measureInWindow?: (cb: (x: number, y: number) => void) => void }
    | undefined;
  extra.box = !!box;
  if (box) inputState.focusTextInput(box);
  else await ask("tap:livechat-box-#:120:806", 9000);
  await sleep(2500);
  extra.keyboardUp = Keyboard.isVisible();
  await shot("livechat-2-tapped");
  await sleep(3500);
  await ask("type:livechat-#:this looks so good, where did you film this? the light on the water is unreal", 12000);
  await shot("livechat-3-typed");
  await sleep(3500);
  // A copy of a line on its way into the chat, as a send launches it.
  const { launchFlight } = require("../../libs/liveChatFlight") as typeof import("../../libs/liveChatFlight");
  for (let i = 0; i < 3; i++) {
    const from = await new Promise<{ x: number; y: number }>((resolve) => {
      if (!box?.measureInWindow) { resolve({ x: 40, y: 700 }); return; }
      box.measureInWindow((x, y) => resolve({ x: x + 2, y: y + 4 }));
    });
    launchFlight(`flying line ${i + 1}`, from);
    await sleep(150 + i * 120);
    await shot(`livechat-4-flying-${i + 1}`);
    await sleep(6000);
  }
  // Keyboard down with words still in the box: the buttons come back and
  // the draft rests on one line beside them.
  Keyboard.dismiss();
  await sleep(1500);
  await shot("livechat-5-draft-keyboard-down");
  await sleep(2000);
  if (box) inputState.focusTextInput(box);
  await sleep(2000);
  await ask("erase:livechat-#:100", 9000);
  await shot("livechat-6-erased");
  await sleep(3500);
  Keyboard.dismiss();
  await sleep(1500);
  extra.keyboardAfter = Keyboard.isVisible();
  await shot("livechat-7-keyboard-down");
  await sleep(3500);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] livechat done: stream ${streamId || "none"}, box ${String(extra.box)}, signed in ${String(signedIn)}`);
}

void (async () => {
  try {
    const mode = await AsyncStorage.getItem(FLAG_KEY);
    if (mode !== "1" && mode !== "pages" && mode !== "probe" && mode !== "login" && mode !== "touch" && mode !== "shorts" && mode !== "wide" && mode !== "keys" && mode !== "shells" && mode !== "bones" && mode !== "wallet" && mode !== "loginsheet" && mode !== "player" && mode !== "menu" && mode !== "speed" && mode !== "livetheme" && mode !== "reactions" && mode !== "rowreactions" && mode !== "freeze" && mode !== "feedline" && mode !== "moments" && mode !== "sharelink" && mode !== "profiletabs" && mode !== "barsback" && mode !== "livechat") return;
    // One walk per launch the script asked for.
    await AsyncStorage.removeItem(FLAG_KEY);
    for (let i = 0; i < 300 && !nav.isReady(); i++) await sleep(200);
    if (mode === "login") await runLogin();
    else if (mode === "pages") await runPages();
    else if (mode === "probe") await runProbe();
    else if (mode === "touch") await runTouch();
    else if (mode === "barsback") await runBarsBack();
    else if (mode === "shorts") await runShorts();
    else if (mode === "shells") await runShells();
    else if (mode === "bones") await runBones();
    else if (mode === "wide") await runWide();
    else if (mode === "keys") await runKeys();
    else if (mode === "wallet") await runWallet();
    else if (mode === "loginsheet") await runLoginSheet();
    else if (mode === "player") await runPlayer();
    else if (mode === "menu") await runMenu();
    else if (mode === "speed") await runSpeed();
    else if (mode === "livetheme") await runLiveTheme();
    else if (mode === "reactions") await runReactions();
    else if (mode === "rowreactions") await runRowReactions();
    else if (mode === "freeze") await runFreeze();
    else if (mode === "feedline") await runFeedLine();
    else if (mode === "sharelink") await runShareLink();
    else if (mode === "moments") await runMoments();
    else if (mode === "profiletabs") await runProfileTabs();
    else if (mode === "livechat") await runLiveChat();
    else await run();
  } catch (error) {
    console.error(`[perf-tour] failed ${String(error)}`);
    extra.error = String(error);
    await save(true);
  }
})();
