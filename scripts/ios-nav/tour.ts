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
  if (signedIn) {
    nav.navigate(ScreenNames.Notifications);
    await sleep(2500);
    if (nav.getCurrentRoute()?.name === ScreenNames.Notifications) nav.goBack();
    await sleep(1800);
    await touchOn("4-swipe-leaderboard-after-bell", ScreenNames.Leaderboard, "swipe");
  }
  // Back's arrow sits at the left of the top pill.
  await touchOn("5-tap-back-leaderboard", ScreenNames.Leaderboard, "tap:27:87");
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
  let nextId = 1;
  try {
    const probe = createVideoPlayer(null);
    const proto = Object.getPrototypeOf(probe) as Record<string, unknown>;
    const patched: string[] = [];
    for (const name of ["play", "replaceAsync", "replace"]) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      proto[name] = function (this: object, ...args: unknown[]) {
        if (!players.has(this)) players.set(this, { id: nextId++, lastT: -1, lastChange: 0, moving: false });
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
  nav.navigate(ScreenNames.ShortsViewer, {});
  await sleep(8000);
  extra.opened = nav.getCurrentRoute()?.name === ScreenNames.ShortsViewer;
  await shot("shorts-open");
  const count = Number(await AsyncStorage.getItem(`${FLAG_KEY}.swipes`)) || 12;
  for (let i = 1; i <= count && extra.opened; i++) {
    await AsyncStorage.setItem(SWIPE_KEY, `vswipe:shorts-${i}`);
    await sleep(5000);
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
  await sleep(5000);
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
    nav.goBack();
    await sleep(5000);
  }
  extra.back = nav.getCurrentRoute()?.name;
  await shot("wide-4-back");
  await sleep(700);
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error(`[perf-tour] wide done: opened ${String(extra.opened)}, full screen ${String(extra.fullscreen)}, back on ${String(extra.back)}`);
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
    await ask("tap:not-now-photo-#:201:802", 5000);
    await ask("tap:not-now-notifications-#:201:649", 5000);
    await shot("0-asks-answered");
    await sleep(700);
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
    if (nav.getCurrentRoute()?.name === ScreenNames.Upload) nav.goBack();
    await sleep(2500);
  }

  // Explore, by its tab in the bottom bar.
  const hadBefore = new Set(liveInputs);
  await ask("tap:search-tab-#:307:812", 4500);
  const before = liveInputs.length;
  await shot("1-explore");
  await sleep(700);
  // The pill's own box when it can be told apart, else a tap on the pill.
  const pill = liveInputs.filter((input) => !hadBefore.has(input))[0];
  if (pill) inputState.focusTextInput(pill);
  else await ask("tap:explore-pill-#:150:87", 2000);
  await sleep(2500);
  const upAfterFocus = up();
  await shot("2-explore-keyboard-up");
  await sleep(700);
  await ask("type:explore-#:rif", 4000);
  await shot("3-explore-typed");
  await sleep(700);
  // The X sits before the sliders button at the end of the pill.
  await ask("tap:explore-x-#:346:87", 4000);
  const upAfterX = up();
  await shot("4-explore-after-x");
  await sleep(700);
  await note("explore-x", { inputs: before, upAfterFocus, upAfterX, route: nav.getCurrentRoute()?.name });
  // And a drag of the list under it closes it too.
  if (pill) inputState.focusTextInput(pill);
  else await ask("tap:explore-pill-#:150:87", 2000);
  await sleep(2500);
  const upAgain = up();
  await ask("drag:explore-#", 4000);
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
      await ask(`drag:${page}-#`, 4000);
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
  await AsyncStorage.removeItem(SWIPE_KEY);
  extra.finishedAt = Date.now();
  await save(true);
  console.error("[perf-tour] done");
}

void (async () => {
  try {
    const mode = await AsyncStorage.getItem(FLAG_KEY);
    if (mode !== "1" && mode !== "pages" && mode !== "probe" && mode !== "login" && mode !== "touch" && mode !== "shorts" && mode !== "wide" && mode !== "keys" && mode !== "shells" && mode !== "bones") return;
    // One walk per launch the script asked for.
    await AsyncStorage.removeItem(FLAG_KEY);
    for (let i = 0; i < 300 && !nav.isReady(); i++) await sleep(200);
    if (mode === "login") await runLogin();
    else if (mode === "pages") await runPages();
    else if (mode === "probe") await runProbe();
    else if (mode === "touch") await runTouch();
    else if (mode === "shorts") await runShorts();
    else if (mode === "shells") await runShells();
    else if (mode === "bones") await runBones();
    else if (mode === "wide") await runWide();
    else if (mode === "keys") await runKeys();
    else await run();
  } catch (error) {
    console.error(`[perf-tour] failed ${String(error)}`);
    extra.error = String(error);
    await save(true);
  }
})();
