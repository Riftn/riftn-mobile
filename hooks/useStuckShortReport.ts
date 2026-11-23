import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { VideoPlayer } from 'expo-video';
import { memoryFootprintMB } from '../modules/media-bridge';
import { postMediaStats } from '../libs/post-media-session';

/**
 * A Short that comes on screen and does not move.
 *
 * People report Shorts that stop starting by themselves "after a while of
 * scrolling", which no short test sees. Each Short that is on screen, wanted
 * and not paused by the viewer, with its clock still after STUCK_MS, is
 * logged once with how far into the scroll it happened (swipe number, time in
 * Shorts) and what the phone was holding (post players alive, JS heap, app
 * memory). A Short that then starts logs how long it took; one that never
 * does within GIVE_UP_MS says so.
 */
const STUCK_MS = 2000;
const GIVE_UP_MS = 15000;
const TICK_MS = 500;
/** Rows one app session may spend on this. */
const SESSION_BUDGET = 20;
let reportsLeft = SESSION_BUDGET;

/** The current scroll: reset when the Shorts viewer opens. */
const scroll = { openedAt: 0, swipes: 0, stuck: 0 };

export function noteShortsViewerOpened(): void {
  scroll.openedAt = Date.now();
  scroll.swipes = 0;
  scroll.stuck = 0;
}

function heapMB(): number | null {
  try {
    const stats = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Record<string, number> } })
      .HermesInternal?.getInstrumentedStats?.();
    const bytes = stats?.js_heapSize;
    return typeof bytes === 'number' ? Math.round(bytes / 1_048_576) : null;
  } catch {
    return null;
  }
}

function read<T>(get: () => T, fallback: T): T {
  try { return get(); } catch { return fallback; }
}

export function useStuckShortReport(player: VideoPlayer | null, active: boolean, options: {
  postId?: string | number | null;
  source?: string | null;
  /** On screen, the viewer has not paused it and nothing is over it. */
  wanted: () => boolean;
  firstFrame: () => boolean;
  /** More state for the report: whether the app itself asked it to play, and so on. */
  detail?: () => Record<string, unknown>;
}): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!active || !player || !options.source) return;
    const swipe = ++scroll.swipes;
    const startedAt = Date.now();
    let lastClock = read(() => player.currentTime, NaN);
    let reportedAt = 0;
    let quietMs = 0;
    let lastTick = startedAt;
    const report = (message: string, extra: Record<string, unknown>) => {
      if (reportsLeft <= 0) return;
      reportsLeft--;
      const ahead = read(() => player.bufferedPosition - player.currentTime, NaN);
      const source = latest.current.source || '';
      require('../libs/errorReporter').reportError('ShortsViewer', [message], {
        level: 'info',
        metadata: {
          ...extra,
          postId: latest.current.postId,
          swipe,
          inShortsMs: scroll.openedAt ? startedAt - scroll.openedAt : null,
          stuckThisScroll: scroll.stuck,
          players: postMediaStats(),
          heapMB: heapMB(),
          memoryMB: memoryFootprintMB(),
          status: read(() => player.status, 'released'),
          playing: read(() => player.playing, false),
          clock: Math.round(read(() => player.currentTime, 0) * 100) / 100,
          bankedAhead: Number.isFinite(ahead) ? Math.round(ahead * 100) / 100 : null,
          firstFrame: latest.current.firstFrame(),
          kind: /\.m3u8(\?|$)/i.test(source) ? 'hls' : 'mp4',
          ...read(() => latest.current.detail?.() ?? {}, {}),
        },
      });
    };
    const timer = setInterval(() => {
      const now = Date.now();
      const step = now - lastTick;
      lastTick = now;
      const clock = read(() => player.currentTime, NaN);
      // Any move counts, a loop back to the start included.
      const moved = Number.isFinite(clock) && Number.isFinite(lastClock) && Math.abs(clock - lastClock) > 0.05;
      lastClock = clock;
      if (moved) {
        if (reportedAt) report('short stuck then started', { stuckMs: now - startedAt });
        clearInterval(timer);
        return;
      }
      // Paused by the viewer, set aside, or not asked to play: not stuck.
      if (AppState.currentState !== 'active' || !latest.current.wanted()) return;
      quietMs += step;
      if (!reportedAt && quietMs >= STUCK_MS) {
        reportedAt = now;
        scroll.stuck++;
        report('short stuck', { stuckMs: now - startedAt });
      } else if (reportedAt && now - startedAt >= GIVE_UP_MS) {
        report('short stuck never started', { stuckMs: now - startedAt });
        clearInterval(timer);
      }
      if (now - startedAt >= GIVE_UP_MS) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active, player, options.source]);
}
