import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { createPlaybackRecovery, playbackSourceIdentity, type PlaybackPhase } from '../libs/playback-recovery';
import { replaceVideoSource } from '../libs/video-source';
import { rewindFinishedVideo } from '../libs/video-start';
import { startReloadedLiveBehindEdge } from '../libs/videoBuffering';

/**
 * Feed and Shorts players start with `waitsToMinimizeStalling: false` so the
 * first frame shows without AVPlayer's pre-roll. With that off, AVPlayer's
 * stall behaviour is the legacy one: when the buffer runs dry it drops the
 * rate to 0 and never resumes on its own. JS then sees a pause while the item
 * is still readyToPlay, takes it for a deliberate one, and the clip stays
 * frozen. So stalls are handed back to AVPlayer, which waits for data and
 * carries on.
 *
 * Not at the first frame, though. Turning the wait on while a clip that has
 * only just started is playing makes AVPlayer stop it there and then until it
 * judges the buffer safe: the clip played, froze, and played again on every
 * start. The hand-over waits until there is a few seconds banked (or the whole
 * clip), when it changes nothing on screen. A clip that runs dry before that
 * is handed over on the spot and asked to carry on.
 */
const HANDOVER_RUNWAY_SECONDS = 3;
const HANDOVER_CHECK_MS = 400;
/** Under this much banked, a pause nobody asked for is the buffer running dry. */
const DRY_BUFFER_SECONDS = 0.3;
/**
 * A live keeps about three seconds ahead (LIVE_BUFFER_OPTIONS), so it runs
 * dry from higher up than a clip does: under a second left when AVPlayer drops
 * its rate is a stall, not someone pausing.
 */
const LIVE_DRY_BUFFER_SECONDS = 1;
/**
 * Reloads a live may spend in a row before it shows "Playback unavailable".
 * The budget comes back once the picture has run again for a while, so a
 * long watch is not one hiccup away from a frozen screen.
 */
const LIVE_MAX_RETRIES = 4;
const waitingThroughStalls = new WeakSet<VideoPlayer>();
const needsStallHandover = (player: VideoPlayer) => Platform.OS === 'ios' && !waitingThroughStalls.has(player);
function bankedSeconds(player: VideoPlayer): { ahead: number; whole: boolean } {
  const at = player.currentTime;
  const banked = player.bufferedPosition;
  const total = player.duration;
  return { ahead: banked - at, whole: Number.isFinite(total) && total > 0 && banked >= total - 0.25 };
}
function hasRunway(player: VideoPlayer): boolean {
  try {
    const { ahead, whole } = bankedSeconds(player);
    // A player that cannot say how much it holds is handed over as before.
    return !Number.isFinite(ahead) || whole || ahead >= HANDOVER_RUNWAY_SECONDS;
  } catch { return true; }
}
function ranDry(player: VideoPlayer, under = DRY_BUFFER_SECONDS): boolean {
  try {
    const { ahead, whole } = bankedSeconds(player);
    return Number.isFinite(ahead) && !whole && ahead < under;
  } catch { return false; }
}
function waitThroughStalls(player: VideoPlayer) {
  if (!needsStallHandover(player)) return;
  waitingThroughStalls.add(player);
  try {
    const current = player.bufferOptions;
    if (current && current.waitsToMinimizeStalling === false) player.bufferOptions = { ...current, waitsToMinimizeStalling: true };
  } catch {}
}

export function usePlaybackRecovery(player: VideoPlayer, source: string | null | undefined, options: {
  component: string;
  postId?: string | number | null;
  allowed: () => boolean;
  /**
   * Hand stalls to AVPlayer only once a few seconds are banked, instead of at
   * the first frame. For players whose every pause goes through
   * `recovery.stop()` first, so a pause that arrives unasked is a stall.
   */
  lateStallHandover?: boolean;
  /**
   * A live stream: several reloads that come back once it plays again, a
   * reload that starts behind the edge instead of at the old position, and a
   * stall that AVPlayer gave up on is picked up again instead of being taken
   * for a pause. Read once, when the player and source are set up.
   */
  live?: boolean;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [phase, setPhase] = useState<PlaybackPhase>('idle');
  const live = !!options.live;
  const recovery = useMemo(() => createPlaybackRecovery({
    allowed: () => !!source && latest.current.allowed(),
    maxRetries: live ? LIVE_MAX_RETRIES : 1,
    resetRetriesOnProgress: live,
    play: async (reload, allowed) => {
      const position = player.currentTime;
      if (reload || player.status === 'error') {
        await replaceVideoSource(player, source!);
        if (!allowed()) return;
        // A live has moved on while it was stuck: the old position is not
        // in the new window, and the edge (a little behind it) is the point.
        if (live) startReloadedLiveBehindEdge(player);
        else if (position > 0 && Number.isFinite(player.duration) && position < player.duration) player.currentTime = position;
      }
      if (allowed()) {
        rewindFinishedVideo(player);
        // Already running (a short started while it was dragged in): asking
        // again makes AVPlayer reset its rate under a playing clip.
        if (reload || !player.playing) player.play();
      }
    },
    pause: () => { try { player.pause(); } catch {} },
    changed: setPhase,
    report: (event, detail) => {
      require('../libs/errorReporter').reportError(latest.current.component, [`playback ${event}`], {
        level: event === 'failed' ? 'error' : 'info',
        metadata: { ...detail, postId: latest.current.postId, source: playbackSourceIdentity(source ?? ''), status: player.status },
      });
    },
  }), [player, source, live]);
  useEffect(() => {
    setPhase('idle');
    // Reads on a player released between closing and reopening a viewer throw;
    // treat it as a player that is not playing.
    const read = <T,>(get: () => T, fallback: T): T => { try { return get(); } catch { return fallback; } };
    let previousTime = read(() => player.currentTime, 0);
    let handover: ReturnType<typeof setInterval> | undefined;
    const subs = [
      player.addListener('statusChange', ({ status, error }) => {
        if (status === 'error') {
          const code = error?.message?.match(/(?:response code|status code):?\s*(\d{3})/i)?.[1];
          recovery.fail(code ? `http-${code}` : 'source-error');
        }
        if (status === 'loading') recovery.waiting();
      }),
      player.addListener('playingChange', ({ isPlaying }) => {
        clearInterval(handover);
        handover = undefined;
        if (isPlaying) {
          if (!latest.current.lateStallHandover) waitThroughStalls(player);
          else if (needsStallHandover(player)) {
            const check = () => {
              if (!hasRunway(player)) return;
              clearInterval(handover);
              handover = undefined;
              waitThroughStalls(player);
            };
            handover = setInterval(check, HANDOVER_CHECK_MS);
            check();
          }
          recovery.watch();
        } else if (read(() => player.status, 'idle') === 'readyToPlay' && !recovery.replacing && recovery.wanted) {
          // Ran dry before the hand-over: let AVPlayer wait for data and go on.
          if (latest.current.lateStallHandover && needsStallHandover(player) && ranDry(player)) {
            waitThroughStalls(player);
            try { player.play(); } catch {}
            return;
          }
          // A live that ran dry: AVPlayer dropped its rate and will not pick
          // up again by itself. Ask it to carry on, and give it the usual
          // window to move before the recovery reloads it. Every pause the
          // viewer makes goes through recovery.stop() first, so it never
          // gets here.
          if (live && ranDry(player, LIVE_DRY_BUFFER_SECONDS)) {
            waitThroughStalls(player);
            try { player.play(); } catch {}
            recovery.waiting();
            return;
          }
          recovery.stop();
        }
      }),
      player.addListener('timeUpdate', ({ currentTime }) => {
        if (read(() => player.playing, false) && currentTime !== previousTime) recovery.progress();
        previousTime = currentTime;
      }),
    ];
    if (read(() => player.playing, false)) { recovery.watch(); recovery.progress(); }
    return () => { clearInterval(handover); subs.forEach(sub => sub.remove()); recovery.stop(); };
  }, [player, recovery, live]);
  return { recovery, phase };
}
