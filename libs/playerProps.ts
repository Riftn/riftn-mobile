import type { VideoPlayer } from "expo-video";

type Writable = "muted" | "staysActiveInBackground" | "showNowPlayingNotification" | "playbackRate";

/**
 * Write a player property only when it actually changes.
 *
 * On iOS expo-video does real work on every write, even of the same value:
 * `muted`, `showNowPlayingNotification` and `staysActiveInBackground`
 * recompute the app's audio session (and can reconfigure it mid-play, which
 * drops the sound for a moment), and `playbackRate` sets AVPlayer's rate,
 * which STARTS a paused player. The Shorts pager writes these from effects,
 * peek handlers and the scroll handler, so repeated writes turned into
 * crackling sound and players starting off screen.
 */
export function setPlayerProp<K extends Writable>(player: VideoPlayer | null | undefined, key: K, value: VideoPlayer[K]): void {
  if (!player) return;
  try {
    if (player[key] !== value) (player as any)[key] = value;
  } catch {
    // Released player: nothing to change.
  }
}
