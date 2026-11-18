/**
 * A song picked for a video post plays WITH the video: it starts, pauses,
 * seeks and speeds up with it, and loops the part the poster picked.
 *
 * It used to play only from the badge under the post, as a player of its
 * own. On Android the two then fought over audio focus: the unmuted video
 * took focus and paused the song, the song took it back and paused the
 * video, so neither was heard. While a song rides on a video, the video
 * mixes instead of taking focus, and only the song holds it.
 *
 * Several surfaces can hold one player at once (the feed card, full screen,
 * the Shorts viewer hand the same player along), so the song is kept per
 * player and counted, and goes when the last holder lets go.
 */
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import type { VideoPlayer } from "expo-video";
import { getVolume } from "./video-preferences";
import { applyVideoVolume, setSongMixGain } from "./dub-mix";
import { mixGain, playableSoundUrl, songTimeFor, soundMix } from "./soundWindow";
import { shareAudioWhenSilent } from "./videoAudioMixing";

interface Attachment {
  url: string;
  holders: number;
  sync: () => void;
  detach: () => void;
}

const attached = new Map<VideoPlayer, Attachment>();

/** How far the song may drift from the picture before it is moved back. */
const DRIFT = 0.35;

function attach(player: VideoPlayer, url: string): Attachment {
  let audio: AudioPlayer | null = null;
  let alive = true;
  let broken = false;
  let seeking = false;
  let loadTimeout: ReturnType<typeof setTimeout> | null = null;
  let audioSub: { remove(): void } | null = null;
  const mix = soundMix(url);

  const restore = () => {
    setSongMixGain(player, null);
    try { applyVideoVolume(player, getVolume()); } catch {}
    shareAudioWhenSilent(player);
  };

  const fail = () => {
    if (!alive || broken) return;
    broken = true;
    try { audio?.pause(); } catch {}
    // A song that will not load must not leave the video silent.
    restore();
  };

  const audible = () => {
    try {
      return player.playing && !player.muted && getVolume() > 0 && mix.song > 0 && player.status === "readyToPlay";
    } catch { return false; }
  };

  const sync = () => {
    if (!alive || broken) return;
    try {
      applyVideoVolume(player, getVolume());
      if (!audible()) {
        if (audio?.playing) audio.pause();
        return;
      }
      if (!audio) {
        // Only now: every feed card with a song would otherwise start
        // streaming it while scrolling past, muted.
        audio = createAudioPlayer({ uri: playableSoundUrl(url) }, { updateInterval: 250 });
        audio.loop = true;
        audioSub = audio.addListener("playbackStatusUpdate", sync);
        loadTimeout = setTimeout(() => { if (!audio?.isLoaded) fail(); }, 30000);
      }
      if (!audio.isLoaded) return;
      audio.volume = getVolume() * mixGain(mix.song);
      if (audio.playbackRate !== player.playbackRate) audio.setPlaybackRate(player.playbackRate);
      if (seeking) return;
      const target = songTimeFor(url, player.currentTime, audio.duration);
      if (Math.abs(audio.currentTime - target) > DRIFT) {
        seeking = true;
        audio.pause();
        const song = audio;
        void song.seekTo(target).then(() => {
          seeking = false;
          if (alive && !broken && audible()) song.play();
        }).catch(fail);
      } else if (!audio.playing) {
        audio.play();
      }
    } catch { fail(); }
  };

  // The song holds audio focus; the video mixes under it.
  try { player.audioMixingMode = "mixWithOthers"; } catch {}
  setSongMixGain(player, mixGain(mix.video));

  const subs = [
    player.addListener("playingChange", sync),
    player.addListener("mutedChange", sync),
    player.addListener("volumeChange", sync),
    player.addListener("playbackRateChange", sync),
    player.addListener("statusChange", sync),
    player.addListener("timeUpdate", sync),
    player.addListener("playToEnd", () => { try { audio?.pause(); } catch {} }),
  ];
  sync();

  return {
    url,
    holders: 0,
    sync,
    detach: () => {
      alive = false;
      if (loadTimeout) clearTimeout(loadTimeout);
      subs.forEach((sub) => { try { sub.remove(); } catch {} });
      audioSub?.remove();
      try { audio?.pause(); audio?.remove(); } catch {}
      audio = null;
      restore();
    },
  };
}

/** Play `url` under `player`. Returns the release for this holder. */
export function holdVideoSoundtrack(player: VideoPlayer, url: string): () => void {
  let entry = attached.get(player);
  if (entry && entry.url !== url) {
    entry.detach();
    attached.delete(player);
    entry = undefined;
  }
  if (!entry) {
    entry = attach(player, url);
    attached.set(player, entry);
  }
  const held = entry;
  held.holders++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.holders--;
    if (held.holders > 0 || attached.get(player) !== held) return;
    attached.delete(player);
    held.detach();
  };
}

/** Re-read the master volume after the volume control moves. */
export function refreshVideoSoundtrack(player: VideoPlayer | null | undefined): void {
  if (player) attached.get(player)?.sync();
}

export function hasVideoSoundtrack(player: VideoPlayer | null | undefined): boolean {
  return !!player && attached.has(player);
}
