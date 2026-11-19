import { storage } from "./storage";

/**
 * Chat lines that have not been confirmed by the server yet, kept on the
 * phone so a "Not sent" line (and its Retry) is still there after the app is
 * closed and reopened. Text and GIF lines only: they carry everything needed
 * to resend. Removed as soon as the server confirms or the sender drops it.
 */
const KEY = "dm-unsent-v1";
/** A line older than this is not worth offering again. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LINES = 50;

export interface UnsentLine<J = unknown> {
  tempId: string;
  savedAt: number;
  job: J;
}

function readAll<J>(): UnsentLine<J>[] {
  try {
    const raw = storage.getString(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list: UnsentLine[]): void {
  try {
    if (list.length) storage.set(KEY, JSON.stringify(list.slice(-MAX_LINES)));
    else storage.delete(KEY);
  } catch {
    // Storage full or unavailable: the line still works for this session.
  }
}

export function saveUnsent<J>(tempId: string, job: J): void {
  const list = readAll().filter(line => line.tempId !== tempId);
  list.push({ tempId, savedAt: Date.now(), job });
  writeAll(list);
}

export function forgetUnsent(tempId: string): void {
  const list = readAll();
  const next = list.filter(line => line.tempId !== tempId);
  if (next.length !== list.length) writeAll(next);
}

/** Saved lines still worth offering, oldest first. Drops expired ones. */
export function loadUnsent<J>(now = Date.now()): UnsentLine<J>[] {
  const list = readAll<J>();
  const fresh = list.filter(line => line?.tempId && line.job && now - (line.savedAt || 0) < MAX_AGE_MS);
  if (fresh.length !== list.length) writeAll(fresh);
  return fresh;
}
