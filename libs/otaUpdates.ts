/**
 * Download updates in the background; apply on the next cold launch.
 *
 * expo-updates checks on launch and applies on the NEXT launch. A phone that
 * is never swiped away — the app just sits in the background between uses —
 * therefore never moves off the bundle it first started on. One tester ran a
 * bundle two days old across four feed fixes for exactly that reason, and
 * pull-to-refresh does nothing for it.
 *
 * Check and download on foreground (rate-limited). Returning from a phone
 * call must preserve the current navigation and media session. A reload is
 * allowed only by an explicit update action, never by an AppState event.
 */
import * as Updates from "expo-updates";

// Updates publish twice a day, so checking more often than this only costs
// requests to the update server.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// A reload interrupts whatever the user was doing, so only take it after an
// absence long enough that they are effectively re-opening the app.
export const APPLY_AFTER_BACKGROUND_MS = 60 * 1000;

let nextCheckAt = 0;
let failureCount = 0;
let updateReady = false;
let checking = false;
let inFlight: Promise<void> | null = null;

export function isUpdateReady(): boolean {
  return updateReady;
}

export function checkForOtaUpdate(now = Date.now()): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return Promise.resolve();
  if (checking) return inFlight ?? Promise.resolve();
  if (now < nextCheckAt) return Promise.resolve();
  inFlight = runCheck(now).finally(() => { inFlight = null; });
  return inFlight;
}

async function runCheck(now: number): Promise<void> {
  checking = true;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      failureCount = 0;
      nextCheckAt = now + CHECK_INTERVAL_MS;
      return;
    }
    // The launch-time check may already have downloaded this update, in which
    // case fetchUpdateAsync reports isNew: false — but the bundle is on disk
    // either way, and the check said it is newer than what is running. Keying
    // "ready" on isNew left a downloaded update waiting for a cold launch that
    // never came, which is exactly the situation this file exists to fix.
    await Updates.fetchUpdateAsync();
    updateReady = true;
    failureCount = 0;
    nextCheckAt = now + CHECK_INTERVAL_MS;
  } catch {
    // Retry on a later foreground with a bounded backoff, never a reload timer.
    nextCheckAt = now + Math.min(60_000 * 2 ** failureCount, 15 * 60_000);
    failureCount = Math.min(failureCount + 1, 4);
  } finally {
    checking = false;
  }
}

/** Reload only from an explicit update action, never from an AppState return. */
export async function applyOtaUpdateIfReady(backgroundMs: number, allowReload = false): Promise<boolean> {
  if (!allowReload || !updateReady || backgroundMs < APPLY_AFTER_BACKGROUND_MS) return false;
  updateReady = false;
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    // Keep going on the current bundle; the next cold launch applies it.
    return false;
  }
}

/**
 * First-run setup only. A fresh install opens on the code its store build was
 * made from, and the update it downloads waits for the next cold launch, so a
 * new person met a sign-in screen weeks behind the current one. Setup already
 * restarts the app for a right-to-left language, with its step saved; the same
 * restart here puts the current code in place before sign-in is ever drawn.
 *
 * `waitMs`: how long to give a download that is still running. Returns false
 * when there is nothing to apply, and the caller carries on as before.
 */
export async function applyOtaUpdateDuringSetup(waitMs = 0): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) return false;
  if (!updateReady && waitMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([checkForOtaUpdate(), new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); })]);
    clearTimeout(timer);
  }
  if (!updateReady) return false;
  updateReady = false;
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}

export function __resetOtaStateForTests(): void {
  nextCheckAt = 0;
  failureCount = 0;
  updateReady = false;
  checking = false;
  inFlight = null;
}
