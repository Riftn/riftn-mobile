import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Linking, Platform } from "react-native";
import { createLogger } from "./logger";
import { track } from "./analytics";

const log = createLogger("review-prompt");

const LAST_PROMPT_KEY = "dehub-review-prompted-at";
const POSTS_KEY = "dehub-posts-published";
const FIRST_TIP_KEY = "dehub-first-tip-seen";
const DAY = 86400_000;
export const REVIEW_COOLDOWN_MS = 90 * DAY;
export const REVIEW_INSTALL_GRACE_MS = 3 * DAY;
export const REVIEW_POST_COUNT = 5;

export type ReviewMoment = "first_tip" | "video_milestone" | "fifth_post";

type StoreReviewModule = typeof import("expo-store-review");

// Required lazily: binaries built before expo-store-review was added do not
// have the native module, and an OTA update must not crash them.
function loadStoreReview(): StoreReviewModule | null {
  try {
    return require("expo-store-review") as StoreReviewModule;
  } catch {
    return null;
  }
}

async function readNumber(key: string): Promise<number> {
  const raw = await AsyncStorage.getItem(key);
  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) ? value : 0;
}

export async function canPromptForReview(now = Date.now()): Promise<boolean> {
  const lastPrompt = await readNumber(LAST_PROMPT_KEY);
  if (lastPrompt && now - lastPrompt < REVIEW_COOLDOWN_MS) return false;
  const installedAt = await Application.getInstallationTimeAsync().catch(() => null);
  if (!installedAt || now - installedAt.getTime() < REVIEW_INSTALL_GRACE_MS) return false;
  return true;
}

/** Ask the OS for its review sheet after a good moment; the OS may still decline to show it. */
export async function requestReviewAfter(moment: ReviewMoment): Promise<boolean> {
  try {
    if (!(await canPromptForReview())) return false;
    const StoreReview = loadStoreReview();
    if (!StoreReview || !(await StoreReview.hasAction())) return false;
    await AsyncStorage.setItem(LAST_PROMPT_KEY, String(Date.now()));
    await StoreReview.requestReview();
    track("review_prompted", { moment });
    return true;
  } catch (error) {
    log.warn("Review prompt failed", { moment, error });
    return false;
  }
}

let postWrites: Promise<unknown> = Promise.resolve();

/** Count posts published from this device: the first is tracked, the fifth asks for a review. */
export function notePostPublished(): Promise<void> {
  const next = postWrites.catch(() => undefined).then(async () => {
    const count = (await readNumber(POSTS_KEY)) + 1;
    await AsyncStorage.setItem(POSTS_KEY, String(count));
    if (count === 1) track("first_post");
    if (count === REVIEW_POST_COUNT) await requestReviewAfter("fifth_post");
  });
  postWrites = next;
  return next.catch((error) => log.warn("Could not count published post", error));
}

/** Tips (first one only) and video milestones are moments worth a review ask. */
export async function noteNotificationMoment(type: string | undefined): Promise<void> {
  try {
    if (type === "video_milestone") {
      await requestReviewAfter("video_milestone");
    } else if (type === "tip") {
      if (await AsyncStorage.getItem(FIRST_TIP_KEY)) return;
      await AsyncStorage.setItem(FIRST_TIP_KEY, "1");
      await requestReviewAfter("first_tip");
    }
  } catch (error) {
    log.warn("Could not record notification moment", error);
  }
}

// ── The Home card ──────────────────────────────────────────────────────────
// A slim "Enjoying Riftn? Rate us" card on Home, for people who keep coming
// back. It links to the store's own review page rather than the OS sheet: the
// OS may silently show nothing (Apple allows three a year), and a button that
// does nothing reads as broken. Shown rarely:
//  - only after the install grace and outside the 90-day cooldown above;
//  - only once Home has been opened on REVIEW_CARD_DAYS different days;
//  - "Not now" hides it for 30 days, the second "Not now" for good;
//  - once someone taps Rate, never again.

const HOME_DAYS_KEY = "dehub-review-home-days";
const CARD_STATE_KEY = "dehub-review-card";
export const REVIEW_CARD_DAYS = 4;
export const REVIEW_CARD_SNOOZE_MS = 30 * DAY;
export const REVIEW_CARD_MAX_DISMISSALS = 2;

const IOS_REVIEW_URL = "https://apps.apple.com/app/id6770382811?action=write-review";
const IOS_REVIEW_DEEP_URL = "itms-apps://apps.apple.com/app/id6770382811?action=write-review";
const ANDROID_REVIEW_DEEP_URL = "market://details?id=io.dehub.mobile";
const ANDROID_REVIEW_URL = "https://play.google.com/store/apps/details?id=io.dehub.mobile";

type CardState = { rated?: boolean; dismissals?: number; snoozeUntil?: number };

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function dayStamp(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Counts each local day Home is opened; returns how many days so far. */
export async function noteHomeVisitDay(now = Date.now()): Promise<number> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return 0;
  try {
    const seen = await readJson<{ last?: string; count?: number }>(HOME_DAYS_KEY, {});
    const today = dayStamp(now);
    if (seen.last === today) return seen.count ?? 0;
    const count = (seen.count ?? 0) + 1;
    await AsyncStorage.setItem(HOME_DAYS_KEY, JSON.stringify({ last: today, count }));
    return count;
  } catch (error) {
    log.warn("Could not record Home visit", error);
    return 0;
  }
}

/** Checks whether a Home visit qualifies once the card can be shown. */
export async function shouldShowReviewCard(days: number, now = Date.now()): Promise<boolean> {
  if (days < REVIEW_CARD_DAYS) return false;
  try {
    const state = await readJson<CardState>(CARD_STATE_KEY, {});
    if (state.rated) return false;
    if ((state.dismissals ?? 0) >= REVIEW_CARD_MAX_DISMISSALS) return false;
    if (state.snoozeUntil && now < state.snoozeUntil) return false;
    return await canPromptForReview(now);
  } catch (error) {
    log.warn("Review card check failed", error);
    return false;
  }
}

export async function dismissReviewCard(now = Date.now()): Promise<void> {
  const state = await readJson<CardState>(CARD_STATE_KEY, {});
  const dismissals = (state.dismissals ?? 0) + 1;
  await AsyncStorage.setItem(CARD_STATE_KEY, JSON.stringify({ ...state, dismissals, snoozeUntil: now + REVIEW_CARD_SNOOZE_MS }));
  track("review_card_dismissed", { dismissals });
}

/** Opens the store's write-a-review page and retires the card for good. */
export async function openStoreReviewPage(now = Date.now()): Promise<void> {
  const state = await readJson<CardState>(CARD_STATE_KEY, {});
  await AsyncStorage.setItem(CARD_STATE_KEY, JSON.stringify({ ...state, rated: true }));
  // Counts as a review ask, so the OS sheet waits out its cooldown too.
  await AsyncStorage.setItem(LAST_PROMPT_KEY, String(now));
  track("review_card_rate", { platform: Platform.OS });
  const [deep, web] = Platform.OS === "ios"
    ? [IOS_REVIEW_DEEP_URL, IOS_REVIEW_URL]
    : [ANDROID_REVIEW_DEEP_URL, ANDROID_REVIEW_URL];
  try {
    await Linking.openURL(deep);
  } catch {
    await Linking.openURL(web).catch((error) => log.warn("Could not open the store review page", error));
  }
}
