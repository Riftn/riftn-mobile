import { AppState, Platform } from "react-native";
import { setAudioModeAsync } from "expo-audio";

/**
 * Keeps the iPhone's audio session able to record while a live broadcast is
 * publishing its microphone over WebRTC.
 *
 * iOS has one audio session per app and the last writer wins. expo-video
 * rewrites it to "playback only" every time any player in the app plays,
 * pauses, mutes or goes to the background (VideoManager.setAudioSession), and
 * so do the playback helpers in libs/audioSession. A playback-only session
 * cannot record, so WebRTC's microphone stops delivering: viewers see the
 * picture with no sound. Worse, once the creator leaves the app (which a
 * screen share does on purpose) an app that is neither recording nor playing
 * is suspended by iOS, so the screen frames stop reaching the encoder and the
 * broadcast dies for every viewer.
 *
 * Nothing here can stop those writers, so while a broadcast holds the session
 * it puts the record category back: straight away, shortly after every app
 * state change (when expo-video pauses its players), and on a slow heartbeat
 * for anything else. Setting the category it already has is a no-op on iOS,
 * and WebRTC restarts its audio unit by itself once recording is allowed again.
 *
 * Mixes with other apps, so a game or video being shared keeps its own sound.
 * Android has no shared category to lose, so it is left alone there.
 */
const HEARTBEAT_MS = 2000;
const AFTER_APP_STATE_MS = [150, 600, 1500, 3000];

let holders = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let pending: ReturnType<typeof setTimeout>[] = [];

function assertRecording(): void {
  setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    allowsBackgroundRecording: true,
    interruptionMode: "mixWithOthers",
  }).catch(() => {});
}

function clearPending(): void {
  pending.forEach(clearTimeout);
  pending = [];
}

/**
 * Start holding the session for a broadcast. Returns the release function;
 * holds nest, and the session goes back to plain playback when the last one
 * is released.
 */
export function holdLiveAudioSession(): () => void {
  if (Platform.OS !== "ios") return () => {};
  holders += 1;
  if (holders === 1) {
    assertRecording();
    heartbeat = setInterval(assertRecording, HEARTBEAT_MS);
    appStateSub = AppState.addEventListener("change", () => {
      clearPending();
      pending = AFTER_APP_STATE_MS.map((ms) => setTimeout(assertRecording, ms));
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders > 0) return;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    appStateSub?.remove();
    appStateSub = null;
    clearPending();
    setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      allowsBackgroundRecording: false,
      interruptionMode: "mixWithOthers",
    }).catch(() => {});
  };
}

/** For tests. */
export function liveAudioHolders(): number {
  return holders;
}
