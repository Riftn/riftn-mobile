/**
 * People for the @ list, answered from the phone first.
 *
 * The list used to stay empty until a search request came back, on every
 * letter. Three things here make it open with names already in it:
 *
 *  - every answer the server gave is kept, so a letter typed again (after a
 *    backspace, or the same tag in the next message) costs nothing;
 *  - a new letter is answered at once by narrowing what is already known:
 *    the answer to the letters before it, the people picked recently, and the
 *    viewer's own short list (people they tagged before or follow);
 *  - that short list and the recent picks are stored, so they are there on
 *    the first @ after the app is opened again.
 *
 * The server still gets asked and its answer replaces the guess, so ranking,
 * bans and blocks stay the server's call. The guess only fills the wait.
 */

import { storage } from "./storage";
import { getAuthUser } from "./auth.utils";
import {
  communityMentionSearch,
  mentionSearch,
  mentionSeed,
  type MentionUser,
} from "../services/mention.service";

/** An exact answer is reused without asking again for this long. */
const ANSWER_FRESH_MS = 60_000;
/** After that it still feeds the instant guess, until it is this old. */
const ANSWER_KEEP_MS = 10 * 60_000;
const MAX_ANSWERS = 80;
/** The viewer's own list is refreshed in the background this often. */
const SEED_FRESH_MS = 30 * 60_000;
/** A stored list older than this is not shown at all. */
const SEED_KEEP_MS = 14 * 24 * 60 * 60_000;
/** How often the signed-in account is looked up again (accounts can be switched). */
const SCOPE_CHECK_MS = 15_000;
const RECENT_MAX = 24;
const LIST_MAX = 10;
const COMMUNITY_MAX = 4;
const STORE_PREFIX = "mention.people.v1:";

type Answer<T> = { at: number; rows: T[] };

/**
 * Answers to a typeahead, by the text that was typed.
 *
 * `fresh` is an answer still good enough to show as final; `fromPrefix` is the
 * rows of the longest earlier text the new one extends, for narrowing while
 * the real answer is on its way.
 */
export class AnswerCache<T> {
  private answers = new Map<string, Answer<T>>();

  constructor(
    private freshMs = ANSWER_FRESH_MS,
    private keepMs = ANSWER_KEEP_MS,
    private max = MAX_ANSWERS,
  ) {}

  fresh(q: string, now = Date.now()): T[] | null {
    const hit = this.answers.get(q);
    return hit && now - hit.at < this.freshMs ? hit.rows : null;
  }

  set(q: string, rows: T[], now = Date.now()): void {
    this.answers.delete(q);
    this.answers.set(q, { at: now, rows });
    if (this.answers.size > this.max) {
      const oldest = this.answers.keys().next().value;
      if (oldest !== undefined) this.answers.delete(oldest);
    }
  }

  fromPrefix(q: string, now = Date.now()): T[] {
    for (let length = q.length; length >= 1; length--) {
      const hit = this.answers.get(q.slice(0, length));
      if (hit && now - hit.at < this.keepMs) return hit.rows;
    }
    return [];
  }

  /** Every row still kept, newest answer first. */
  all(now = Date.now()): T[] {
    const rows: T[] = [];
    for (const hit of Array.from(this.answers.values()).reverse()) {
      if (now - hit.at < this.keepMs) rows.push(...hit.rows);
    }
    return rows;
  }

  clear(): void {
    this.answers.clear();
  }
}

/** 0 the handle itself, 1 handle starts with it, 2 a word of the name does, 3 anywhere, -1 no match. */
export function mentionMatchRank(user: Pick<MentionUser, "username" | "displayName">, q: string): number {
  const name = (user.username || "").toLowerCase();
  const display = (user.displayName || "").toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (display.startsWith(q) || display.split(/[\s_.-]+/).some((word) => word.startsWith(q))) return 2;
  if (name.includes(q) || display.includes(q)) return 3;
  return -1;
}

// ── Per-account state ───────────────────────────────────────────────────────
// Follows, blocks and the short list all belong to one account, so everything
// here is dropped when the signed-in account changes.

let scope: string | null = null;
let scopeCheckedAt = 0;
let scopeChecking: Promise<void> | null = null;
const peopleAnswers = new AnswerCache<MentionUser>();
const communityAnswers = new AnswerCache<MentionUser>();
const peopleInflight = new Map<string, Promise<MentionUser[]>>();
const communityInflight = new Map<string, Promise<MentionUser[]>>();
let seed: MentionUser[] = [];
let seedAt = 0;
let seedLoading: Promise<void> | null = null;
let recent: MentionUser[] = [];

/** Only what a row shows, so the stored copy stays small. */
function slim(user: MentionUser): MentionUser {
  return {
    username: user.username,
    displayName: user.displayName || "",
    avatarImageUrl: user.avatarImageUrl || "",
    address: user.address,
    isFollowing: !!user.isFollowing,
    ...(user.isAssistant ? { isAssistant: true } : null),
  };
}

function enterScope(next: string): void {
  if (next === scope) return;
  // The first look-up only puts a name to the account already in use, so
  // what was asked in the moment before it is still that account's.
  if (scope !== null) {
    peopleAnswers.clear();
    communityAnswers.clear();
    peopleInflight.clear();
    communityInflight.clear();
  }
  scope = next;
  seed = [];
  seedAt = 0;
  seedLoading = null;
  recent = [];
  try {
    const stored = JSON.parse(storage.getString(STORE_PREFIX + scope) || "null") as
      | { seedAt?: number; seed?: MentionUser[]; recent?: MentionUser[] }
      | null;
    if (stored && Array.isArray(stored.recent)) recent = stored.recent.filter((u) => u?.username).slice(0, RECENT_MAX);
    if (stored && Array.isArray(stored.seed) && Date.now() - (stored.seedAt || 0) < SEED_KEEP_MS) {
      seed = stored.seed.filter((u) => u?.username);
      seedAt = stored.seedAt || 0;
    }
  } catch {
    /* unreadable store: the lists just start empty */
  }
}

function store(): void {
  if (scope === null) return;
  try {
    storage.set(STORE_PREFIX + scope, JSON.stringify({ seedAt, seed, recent }));
  } catch {
    /* nothing to do: the lists still work until the app closes */
  }
}

function refreshSeed(): void {
  if (scope === null || scope === "anon" || seedLoading || Date.now() - seedAt < SEED_FRESH_MS) return;
  const forScope = scope;
  seedLoading = mentionSeed()
    .then((rows) => {
      if (forScope !== scope) return;
      seed = rows.filter((u) => u?.username && u?.address).map(slim);
      seedAt = Date.now();
      store();
    })
    .catch(() => {
      // Tried; do not ask again on every key. The search still answers.
      if (forScope === scope) seedAt = Date.now() - SEED_FRESH_MS + 60_000;
    })
    .finally(() => {
      if (forScope === scope) seedLoading = null;
    });
}

/**
 * Get the viewer's short list ready. Cheap to call on every keystroke: it does
 * something only now and then, and never holds the typing up.
 */
export function warmMentionPeople(): void {
  const now = Date.now();
  if (scopeChecking) return;
  if (scope !== null && now - scopeCheckedAt < SCOPE_CHECK_MS) {
    refreshSeed();
    return;
  }
  scopeChecking = Promise.resolve()
    .then(() => getAuthUser<{ address?: string }>())
    .catch(() => null)
    .then((user) => {
      scopeCheckedAt = Date.now();
      enterScope(String(user?.address || "anon").toLowerCase());
      refreshSeed();
    })
    .finally(() => {
      scopeChecking = null;
    });
}

/** A person was tagged: offer them first next time. */
export function rememberMentionPick(user: MentionUser): void {
  if ((user.kind ?? "user") !== "user" || !user.username || !user.address) return;
  if (scope === null) return;
  recent = [slim(user), ...recent.filter((u) => u.address !== user.address)].slice(0, RECENT_MAX);
  store();
}

/** The server's answer for these letters, if it was asked a moment ago. */
export function settledPeople(q: string): MentionUser[] | null {
  return peopleAnswers.fresh(q);
}

/**
 * The best list the phone can give right now, without asking anyone: recent
 * picks, then the viewer's own people, then anyone an earlier answer named,
 * each narrowed to the letters typed.
 */
export function guessPeople(q: string): MentionUser[] {
  if (!q) return [];
  const seen = new Set<string>();
  const scored: Array<{ user: MentionUser; source: number; rank: number; order: number }> = [];
  const add = (users: MentionUser[], source: number) => {
    for (const user of users) {
      const key = user.address || user.username;
      if (!key || seen.has(key)) continue;
      const rank = mentionMatchRank(user, q);
      if (rank < 0) continue;
      seen.add(key);
      scored.push({ user, source, rank, order: scored.length });
    }
  };
  add(recent, 0);
  add(seed, 1);
  add(peopleAnswers.fromPrefix(q), 2);
  add(peopleAnswers.all(), 3);
  // The assistant leads its own matches, then the handle typed in full, then
  // the viewer's own people before strangers, a closer spelling first.
  const lead = (row: { user: MentionUser; rank: number }) => (row.user.isAssistant ? 0 : row.rank === 0 ? 1 : 2);
  scored.sort((a, b) => lead(a) - lead(b) || Math.min(a.source, 2) - Math.min(b.source, 2) || a.rank - b.rank || a.order - b.order);
  return scored.slice(0, LIST_MAX).map((row) => row.user);
}

/**
 * Ask the server. One request per text however many boxes want it.
 *
 * An empty answer is not kept: the search reports a failed request as nobody
 * found, and "nobody" is cheap to ask again.
 */
export function fetchPeople(q: string): Promise<MentionUser[]> {
  const cached = peopleAnswers.fresh(q);
  if (cached) return Promise.resolve(cached);
  const running = peopleInflight.get(q);
  if (running) return running;
  const forScope = scope;
  const request = mentionSearch(q).then(
    (people) => {
      peopleInflight.delete(q);
      if (people.length > 0 && (forScope === null || forScope === scope)) peopleAnswers.set(q, people);
      return people;
    },
    (error) => {
      peopleInflight.delete(q);
      throw error;
    },
  );
  peopleInflight.set(q, request);
  return request;
}

export function settledCommunities(q: string): MentionUser[] | null {
  return communityAnswers.fresh(q);
}

/** Communities an earlier answer named that still match, while the real answer loads. */
export function guessCommunities(q: string): MentionUser[] {
  return communityAnswers
    .fromPrefix(q)
    .filter((c) => (c.displayName || "").toLowerCase().includes(q) || (c.username || "").toLowerCase().includes(q))
    .slice(0, COMMUNITY_MAX);
}

export function fetchCommunities(q: string): Promise<MentionUser[]> {
  const cached = communityAnswers.fresh(q);
  if (cached) return Promise.resolve(cached);
  const running = communityInflight.get(q);
  if (running) return running;
  const request = communityMentionSearch(q).then(
    (rows) => {
      communityInflight.delete(q);
      communityAnswers.set(q, rows);
      return rows;
    },
    (error) => {
      communityInflight.delete(q);
      throw error;
    },
  );
  communityInflight.set(q, request);
  return request;
}

/** For tests: forget everything, as a fresh start of the app would. */
export function resetMentionPeople(): void {
  scope = null;
  scopeCheckedAt = 0;
  scopeChecking = null;
  peopleAnswers.clear();
  communityAnswers.clear();
  peopleInflight.clear();
  communityInflight.clear();
  seed = [];
  seedAt = 0;
  seedLoading = null;
  recent = [];
}
