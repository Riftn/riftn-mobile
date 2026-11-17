/**
 * Auto-translate budget
 * =====================
 * How many translations one device may start on its own in an hour.
 *
 * Auto-translate runs on every foreign line a reader sees: posts, live chat
 * and messages they receive. A normal session uses a few dozen an hour; a busy
 * foreign-language chat could ask for thousands, and each cache miss can reach
 * a paid tier. Past the budget nothing translates unasked until the hour rolls
 * over. Tapping Translate still works.
 *
 * Same number as web's `src/lib/auto-translate-budget.ts`.
 *
 * @module libs/auto-translate-budget
 */

import { storage } from './storage';

export const AUTO_TRANSLATE_HOURLY_BUDGET = 150;
const WINDOW_MS = 60 * 60 * 1000;
const KEY = 'riftn-auto-translate-budget';

let memory: number[] = [];

function read(now: number): number[] {
  let stamps = memory;
  try {
    const raw = storage.getString(KEY);
    if (raw) stamps = JSON.parse(raw);
  } catch {
    // Storage unavailable: the in-memory copy still limits this session.
  }
  return Array.isArray(stamps) ? stamps.filter((t) => typeof t === 'number' && now - t < WINDOW_MS && t <= now) : [];
}

/** Claims one automatic translation. False once this hour's budget is spent. */
export function takeAutoTranslateSlot(now = Date.now()): boolean {
  const stamps = read(now);
  if (stamps.length >= AUTO_TRANSLATE_HOURLY_BUDGET) {
    memory = stamps;
    return false;
  }
  stamps.push(now);
  memory = stamps;
  try {
    storage.set(KEY, JSON.stringify(stamps));
  } catch {
    // Not persisted; the in-memory copy still counts.
  }
  return true;
}

/** Tests only. */
export function __resetAutoTranslateBudget() {
  memory = [];
  try { storage.delete(KEY); } catch { /* ignore */ }
}
