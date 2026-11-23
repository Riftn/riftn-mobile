import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
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
/**
 * A short is asked to play the moment it is swiped to, often before any of it
 * has arrived. AVPlayer takes the request, calls itself playing and tries to
 * start exactly once: with nothing buffered that try fails, and from then on
 * it only starts when it judges the whole clip safe to play through. On a slow
 * connection that is seconds of a still first frame with the clip already
 * there, and pausing and playing by hand started it at once. So the start is
 * watched until the clock runs: a player sitting paused is asked again, and
 * one holding a second of video without moving is given that pause and play.
 */
const START_TICK_MS = 250;
/** Under the recovery's own ten second reload, which takes over from there. */
const START_WATCH_MS = 9000;
const START_MAX_ASKS = 3;
const START_ASK_GAP_MS = 600;
/** Ticks in a row with video banked and a still clock before the pause and play. */
const START_HELD_TICKS = 3;
const START_HELD_SECONDS = 1;
/** A pause nobody asked for this soon after the ask is the start going wrong. */
const START_WINDOW_MS = 2000;
const START_REPORT_GAP_MS = 20_000;
let lastStartReportAt = 0;
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
function playedOut(player: VideoPlayer): boolean {
  try {
    const total = player.duration;
    return Number.isFinite(total) && total > 0 && player.currentTime >= total - 0.25;
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
  // The play request being seen through (see START_TICK_MS).
  const ask = useRef({ at: 0, asks: 0, moved: false, quietUntil: 0 });
  const watchStart = useRef<(() => void) | null>(null);
  const recovery = useMemo(() => createPlaybackRecovery({
    allowed: () => !!source && latest.current.allowed(),
    maxRetries: live ? LIVE_MAX_RETRIES : 1,
    resetRetriesOnProgress: live,
    play: async (reload, allowed) => {
      const position = player.currentTime;
      if (reload || player.status === 'error') {
        await replaceVideoSource(player, source!, { immediate: !!latest.current.lateStallHandover });
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
        ask.current = { at: Date.now(), asks: 0, moved: false, quietUntil: 0 };
        watchStart.current?.();
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
    // Seeing a start through. Only for players whose every pause goes through
    // recovery.stop() first (the Shorts viewer), and only on iPhone.
    const seesStartsThrough = () => !!latest.current.lateStallHandover && Platform.OS === 'ios';
    const inFront = () => AppState.currentState == null || AppState.currentState === 'active';
    let startWatch: ReturnType<typeof setInterval> | undefined;
    let lastSeenTime = NaN;
    let lastAskAt = 0;
    let heldTicks = 0;
    let helped: 'paused' | 'held' | null = null;
    const endStartWatch = () => { clearInterval(startWatch); startWatch = undefined; };
    const reportStart = (outcome: 'helped' | 'stuck') => {
      const now = Date.now();
      if (!helped || now - lastStartReportAt < START_REPORT_GAP_MS) return;
      lastStartReportAt = now;
      require('../libs/errorReporter').reportError(latest.current.component, [`playback start ${outcome}`], {
        level: 'info',
        metadata: {
          how: helped, asks: ask.current.asks, elapsedMs: now - ask.current.at, sinceAskMs: now - lastAskAt,
          postId: latest.current.postId, source: playbackSourceIdentity(source ?? ''), status: read(() => player.status, 'idle'),
        },
      });
    };
    const askAgain = (how: 'paused' | 'held') => {
      ask.current.asks++;
      lastAskAt = Date.now();
      heldTicks = 0;
      helped = how;
      try {
        if (how === 'held') {
          // Its own pause must not be read as the clip stopping.
          ask.current.quietUntil = lastAskAt + START_ASK_GAP_MS;
          player.pause();
        }
        player.play();
      } catch {}
    };
    const startTick = () => {
      const now = Date.now();
      if (!recovery.wanted) { endStartWatch(); return; }
      const time = read(() => player.currentTime, NaN);
      const before = lastSeenTime;
      lastSeenTime = time;
      if (time > before + 0.03) {
        ask.current.moved = true;
        // The recovery hears progress from the player's ticks; a clip running
        // without them would be reloaded at ten seconds for nothing.
        if (read(() => player.playing, false)) recovery.progress();
        reportStart('helped');
        endStartWatch();
        return;
      }
      if (now - ask.current.at > START_WATCH_MS || ask.current.asks >= START_MAX_ASKS) {
        if (now - lastAskAt >= 2 * START_ASK_GAP_MS) { reportStart('stuck'); endStartWatch(); }
        return;
      }
      const status = read(() => player.status, 'idle');
      if (recovery.replacing || status === 'error' || status === 'idle' || !inFront() || !latest.current.allowed()) { heldTicks = 0; return; }
      if (now - ask.current.at < START_TICK_MS || now - lastAskAt < START_ASK_GAP_MS) return;
      if (!read(() => player.playing, false)) { askAgain('paused'); return; }
      const banked = read(() => bankedSeconds(player), { ahead: 0, whole: false });
      heldTicks = banked.whole || banked.ahead >= START_HELD_SECONDS ? heldTicks + 1 : 0;
      if (heldTicks >= START_HELD_TICKS) askAgain('held');
    };
    watchStart.current = () => {
      endStartWatch();
      if (!seesStartsThrough()) return;
      lastSeenTime = NaN;
      lastAskAt = 0;
      heldTicks = 0;
      helped = null;
      startWatch = setInterval(startTick, START_TICK_MS);
    };
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
        } else if (seesStartsThrough() && !recovery.replacing && recovery.wanted) {
          // Nobody here paused it: every pause the viewer makes stops the
          // recovery first.
          const status = read(() => player.status, 'idle');
          if (Date.now() < ask.current.quietUntil || status === 'error' || status === 'idle') return;
          if (!inFront() || playedOut(player)) {
            // Set aside by the system, or the end of the clip.
            if (status === 'readyToPlay') recovery.stop();
            return;
          }
          const resume = () => {
            try { player.play(); } catch {}
            recovery.waiting();
          };
          // Ran dry: let AVPlayer wait for data and go on. It used to be
          // picked up only when the player still called itself ready, and one
          // that had already said "loading" stayed frozen until the reload.
          if (ranDry(player) && (status === 'readyToPlay' || read(() => player.currentTime, 0) > 0)) {
            waitThroughStalls(player);
            resume();
            return;
          }
          if (status === 'loading') { resume(); return; }
          // Stopped before it ever ran, or just as it started: the start
          // going wrong (a pause from the swipe landing after the play, the
          // audio session changing hands), not someone pausing.
          const sinceAsk = Date.now() - ask.current.at;
          const starting = sinceAsk < START_WINDOW_MS || (!ask.current.moved && sinceAsk < START_WATCH_MS);
          if (starting && ask.current.asks < START_MAX_ASKS) {
            ask.current.asks++;
            resume();
            return;
          }
          recovery.stop();
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
    return () => {
      clearInterval(handover);
      endStartWatch();
      watchStart.current = null;
      subs.forEach(sub => sub.remove());
      recovery.stop();
    };
  }, [player, recovery, live]);
  return { recovery, phase };
}
