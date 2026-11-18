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

function syncSession() {
  const want = audible.size > 0;
  if (want === sessionHeld) return;
  sessionHeld = want;
  // Loaded on first use so this module stays light (and loads without the
  // native audio module in tests).
  import("./audioSession")
    .then((m) => (want ? m.configureForBackgroundPlayback() : m.releaseBackgroundPlayback()))
    .catch(() => {});
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
    if (player.showNowPlayingNotification !== on) player.showNowPlayingNotification = on;
  } catch {
    // Released player: nothing to keep alive.
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
