import { isPictureInPicturePlayer, releaseAfterPictureInPicture } from './pictureInPicture';
import type { VideoPlayer } from 'expo-video';

/** Keeps a native media session alive while its visible surface changes. */
export interface PostMediaSession<T> {
  value: T | null;
  claims: object[];
  priorityOwner?: object;
  dispose: (value: T) => void;
  timer?: ReturnType<typeof setTimeout>;
  transferUntil: number;
  userPaused: boolean;
  loadedSource?: string | null;
  listeners: Set<() => void>;
  /** Set on the first claim. Only a session that was held and let go counts as parked. */
  claimed?: boolean;
}

const sessions = new Map<string, PostMediaSession<any>>();
const GRACE_MS = 2000;

function disposeSession<T>(key: string, session: PostMediaSession<T>) {
  if (session.claims.length) return;
  if (isPictureInPicturePlayer(session.value)) {
    releaseAfterPictureInPicture(session.value as unknown as VideoPlayer, () => disposeSession(key, session));
    return;
  }
  clearTimeout(session.timer);
  // A session that already left the map (another one took its key) still owns
  // its native player. Skipping it here used to leave that decoder running
  // for the rest of the app session: after a long Shorts scroll the phone held
  // dozens of them, which is the heat, the stutter and the crackling sound.
  if (sessions.get(key) === session) sessions.delete(key);
  if (session.value) session.dispose(session.value);
  session.value = null;
}

function scheduleRelease<T>(key: string, session: PostMediaSession<T>) {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => disposeSession(key, session), GRACE_MS);
  // A session created by a render that has not committed yet has no claim so
  // far; evicting it would release a player its screen is about to use.
  const parked = [...sessions].filter(([, item]) => !item.claims.length && item.value && item.claimed);
  while (parked.length > 2) {
    const [oldKey, oldSession] = parked.shift()!;
    disposeSession(oldKey, oldSession);
  }
}

export function postMediaSession<T>(key: string, dispose: (value: T) => void): PostMediaSession<T> {
  let session = sessions.get(key);
  if (!session) {
    session = { value: null, claims: [], dispose, transferUntil: 0, userPaused: false, listeners: new Set() };
    sessions.set(key, session);
    scheduleRelease(key, session);
  }
  return session;
}

export function claimPostMedia<T>(key: string, session: PostMediaSession<T>, token: object, priority = false): () => void {
  clearTimeout(session.timer);
  // Put a session that was dropped from the map back, so later lookups and
  // its own release find it instead of a second player for the same clip.
  if (!sessions.has(key)) sessions.set(key, session);
  session.claimed = true;
  session.claims.push(token);
  if (priority) session.priorityOwner = token;
  session.transferUntil = 0;
  session.listeners.forEach(fn => fn());
  return () => {
    const index = session.claims.indexOf(token);
    if (index >= 0) session.claims.splice(index, 1);
    if (session.priorityOwner === token) session.priorityOwner = undefined;
    session.listeners.forEach(fn => fn());
    if (session.claims.length) return;
    if (!postMediaIsTransferring(session) && !isPictureInPicturePlayer(session.value)) {
      try { (session.value as { pause?: () => void } | null)?.pause?.(); } catch {}
    }
    scheduleRelease(key, session);
  };
}

export function ownsPostMedia<T>(session: PostMediaSession<T>, token: object): boolean {
  return (session.priorityOwner ?? session.claims[session.claims.length - 1]) === token;
}

export function preparePostMediaNavigation(url: string | null | undefined, options?: { replayEndingVideo?: boolean }): void {
  if (!url) return;
  for (const kind of ['video', 'audio']) {
    const session = sessions.get(`${kind}:${url}`);
    if (!session) continue;
    session.transferUntil = Date.now() + GRACE_MS;
    if (kind === 'video' && options?.replayEndingVideo && session.value) {
      const player: VideoPlayer = session.value;
      try {
        // A feed preview can end during navigation. Opening it explicitly
        // should play that clip before the viewer advances to its neighbour.
        const { duration, currentTime } = player;
        if (Number.isFinite(duration) && duration > 0 && currentTime > 0 &&
          duration - currentTime <= Math.min(GRACE_MS / 1000, duration / 4)) player.currentTime = 0;
      } catch { /* a released preview will be recreated by the viewer */ }
    }
  }
}

export function postMediaIsTransferring<T>(session: PostMediaSession<T>): boolean {
  return session.transferUntil > Date.now();
}

export function hasPostVideoSession(url: string | null | undefined): boolean {
  return !!url && !!sessions.get(`video:${url}`)?.value;
}

/**
 * How many post players exist right now: `players` hold a native player,
 * `held` are on a screen, `parked` wait out their grace before release. A
 * number that keeps climbing through a long Shorts scroll is a leak.
 */
export function postMediaStats(): { players: number; held: number; parked: number } {
  let players = 0, held = 0, parked = 0;
  for (const session of sessions.values()) {
    if (!session.value) continue;
    players++;
    if (session.claims.length) held++; else parked++;
  }
  return { players, held, parked };
}
