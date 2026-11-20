import { AppState } from "react-native";
import type { VideoPlayer } from "expo-video";

/**
 * A video playing WITH SOUND keeps playing when the app is minimised or the
 * screen locks, like a music app; a silent one (muted feed autoplay, a
 * preloaded short) still pauses. That is the default for every player that
 * goes through shareAudioWhenSilent.
 *
 * expo-video pauses a player on backgrounding unless `staysActiveInBackground`
 * is set at that moment, so the flag follows the player: on while it plays
 * audibly, off otherwise. The iOS session must allow background playback too
 * (UIBackgroundModes audio is in the shipped binary); it is switched on while
 * any followed player is audible and handed back when none is.
 */
const followed = new WeakSet<VideoPlayer>();
const audible = new Set<VideoPlayer>();
let sessionHeld = false;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Swiping shorts pauses one player and starts the next a moment later. The
 * session is only handed back once nothing has been audible for this long, so
 * it is not switched off and on again on every swipe (a reconfigure mid-play
 * can click or dull the sound).
 */
const RELEASE_AFTER_MS = 4000;

/**
 * How long a player that went quiet stays the app's "now playing" one.
 *
 * iOS decides from that flag whether this app's sound may mix with other
 * apps'. Dropping it the moment a video stalled, or the viewer swiped to the
 * next short, switched the whole audio session over to mixing, and the next
 * frame of sound switched it straight back: twice per stall, twice per swipe.
 * Each switch cuts the sound for a moment and can stall the player again,
 * which is how one hiccup turned into sound chopped into bursts over a
 * stuttering picture until the short was left. Held this long, a stall or a
 * swipe changes nothing.
 */
const NOW_PLAYING_HOLD_MS = 4000;
const nowPlayingOff = new Map<VideoPlayer, ReturnType<typeof setTimeout>>();

function keepNowPlaying(player: VideoPlayer) {
  const pending = nowPlayingOff.get(player);
  if (pending) { clearTimeout(pending); nowPlayingOff.delete(player); }
  if (!player.showNowPlayingNotification) player.showNowPlayingNotification = true;
}

function dropNowPlayingLater(player: VideoPlayer) {
  if (!player.showNowPlayingNotification || nowPlayingOff.has(player)) return;
  nowPlayingOff.set(player, setTimeout(() => {
    nowPlayingOff.delete(player);
    try {
      if (!isAudible(player) && player.showNowPlayingNotification) player.showNowPlayingNotification = false;
    } catch {
      // Released meanwhile: nothing left to switch off.
    }
  }, NOW_PLAYING_HOLD_MS));
}

function applySession(want: boolean) {
  if (want === sessionHeld) return;
  sessionHeld = want;
  // Loaded on first use so this module stays light (and loads without the
  // native audio module in tests).
  import("./audioSession")
    .then((m) => (want ? m.configureForBackgroundPlayback() : m.releaseBackgroundPlayback()))
    .catch(() => {});
}

function syncSession() {
  const want = audible.size > 0;
  if (want) {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    applySession(true);
    return;
  }
  if (!sessionHeld || releaseTimer) return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (audible.size === 0) applySession(false);
  }, RELEASE_AFTER_MS);
}

function isAudible(player: VideoPlayer): boolean {
  try {
    return player.playing && !player.muted && (player.volume ?? 1) > 0;
  } catch {
    return false;
  }
}

function update(player: VideoPlayer) {
  const on = isAudible(player);
  try {
    if (player.staysActiveInBackground !== on) player.staysActiveInBackground = on;
    if (on) keepNowPlaying(player);
    else dropNowPlayingLater(player);
  } catch {
    // Released player: nothing to keep alive.
    const pending = nowPlayingOff.get(player);
    if (pending) { clearTimeout(pending); nowPlayingOff.delete(player); }
    audible.delete(player);
    syncSession();
    return;
  }
  if (on) audible.add(player);
  else audible.delete(player);
  syncSession();
}

export function followSoundInBackground(player: VideoPlayer | null | undefined): void {
  if (!player || followed.has(player)) return;
  followed.add(player);
  try {
    const subs = [
      player.addListener("playingChange", () => update(player)),
      player.addListener("mutedChange", () => update(player)),
      player.addListener("volumeChange", () => update(player)),
      player.addListener("statusChange", (e) => {
        const status = e?.status;
        if (status === "error" || status === "idle") update(player);
      }),
    ];
    void subs;
  } catch {
    // Player already released.
  }
  update(player);
}

/** True while some followed video is playing with sound (it will keep playing in the background). */
export function videoSoundPlaying(): boolean {
  for (const p of audible) if (!isAudible(p)) audible.delete(p);
  return audible.size > 0;
}

// A player released mid-play never reports that it stopped; prune on every
// app state change so the session is handed back.
try {
  AppState?.addEventListener?.("change", () => {
    videoSoundPlaying();
    syncSession();
  });
} catch {
  // No AppState (tests that mock react-native partly).
}
