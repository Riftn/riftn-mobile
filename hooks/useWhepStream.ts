/**
 * A live stream, played over WebRTC, for as long as it works.
 *
 * Owns one WHEP session: opens it when asked, tears it down on the way out,
 * mirrors the viewer's mute switch onto the remote audio track, and — the part
 * every caller depends on — reports failure instead of hiding it, so the
 * surface can fall back to HLS. WebRTC keeps a viewer close to the live edge
 * but is not available on every network.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { MediaStream } from 'react-native-webrtc';
import { whepEndpointFor, type LiveStreamRef } from '../libs/live-ingest';
import type { WhepSubscription } from '../libs/whep';
import {
  forgetWhepSilent,
  isRealPicture,
  rememberWebRtcBlocked,
  rememberWhepSilent,
  webRtcRecentlyBlocked,
  whepRecentlySilent,
} from '../libs/whep-memory';

/**
 * A session that negotiates but never delivers is the worst case: no error to
 * catch and nothing on screen. Give it this long to show a real picture, then
 * hand over to HLS. A connected session does not count: some broadcasts
 * connect fine and never send a frame, which used to leave the viewer on a
 * spinner for good.
 */
const START_TIMEOUT_MS = 3500;

/**
 * How long the connection itself gets once the server has answered. On a
 * network that carries WebRTC it is up in about half a second. One still not
 * up after this is a network that drops the media, and waiting out the rest
 * of the start timeout only keeps the viewer on a spinner.
 */
const CONNECT_TIMEOUT_MS = 2000;

/**
 * Once the picture is up, how long it may stand still, or the connection sit
 * in "reconnecting", before the viewer moves to HLS. WebRTC has no buffer to
 * fall back on: when the media stops, the last frame just stays on screen,
 * and the only state the connection reports is "connected". Without this a
 * dropped session froze the live until it was closed and opened again.
 */
export const WHEP_FROZEN_MS = 5000;
const WHEP_FROZEN_CHECK_MS = 1000;

interface Options {
  /** False while the stream is not live, is gated, or is playing a replay. */
  enabled: boolean;
  /** Identifies the broadcast; only a self-hosted one has a WHEP endpoint. */
  stream: LiveStreamRef | null | undefined;
  /** The viewer's sound switch, applied to the remote audio track. */
  muted?: boolean;
  /**
   * The broadcaster paused: no frames is expected, not a frozen session, so
   * the freeze watch holds off until they are back.
   */
  paused?: boolean;
}

interface Result {
  /** Non-null once media is attached — render it, otherwise fall back. */
  stream: MediaStream | null;
  /** True once WebRTC is out of the picture for this stream. */
  failed: boolean;
  /**
   * An attempt is in flight and has neither arrived nor given up.
   *
   * Callers hold the fallback back while this is true. Starting HLS in the
   * meantime works, but it means the viewer watches the picture begin and then
   * restart a second later when WebRTC arrives — and on the surface this
   * matters most, WebRTC opens faster than a ladder can buffer its first
   * segments anyway. False whenever there is nothing to wait for: a Livepeer
   * stream, a replay, or a gated one.
   */
  pending: boolean;
  /** Report the picture size the WebRTC surface rendered. */
  onPicture: (size: { width: number; height: number }) => void;
}

export function useWhepStream({ enabled, stream, muted = false, paused = false }: Options): Result {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [attached, setAttached] = useState<{ endpoint: string; stream: MediaStream } | null>(null);
  const [failedEndpoint, setFailedEndpoint] = useState<string | null>(null);

  const playbackId = stream?.playbackId ?? null;
  // Checked once per stream: a stream that just went silent here starts on
  // HLS, and so does every stream on a network that just dropped WebRTC.
  const silentBefore = useMemo(() => whepRecentlySilent(playbackId) || webRtcRecentlyBlocked(), [playbackId]);
  const requestedEndpoint = enabled && !silentBefore ? whepEndpointFor(stream) : null;
  const failed = requestedEndpoint != null && failedEndpoint === requestedEndpoint;
  const endpoint = failed ? null : requestedEndpoint;
  const media = attached?.endpoint === endpoint ? attached.stream : null;
  const pictureRef = useRef<() => void>(() => undefined);
  const onPicture = useCallback((size: { width: number; height: number }) => {
    if (isRealPicture(size)) pictureRef.current();
  }, []);

  useEffect(() => {
    if (!endpoint) return;

    let cancelled = false;
    let session: WhepSubscription | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pictured = false;
    pictureRef.current = () => {
      if (pictured || cancelled) return;
      pictured = true;
      clearTimeout(timer);
      forgetWhepSilent(playbackId);
    };

    let watchdog: ReturnType<typeof setInterval> | undefined;
    let reconnectingSince = 0;
    let connected = false;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;

    const giveUp = (reason: string) => {
      if (cancelled) return;
      // A late answer or state event can arrive before React cleans up the
      // effect. The attempt ends here so it cannot replace the HLS picture.
      cancelled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      clearTimeout(connectTimer);
      void session?.stop();
      session = undefined;
      setAttached(null);
      // Latched: one attempt per stream. Without it a flapping connection
      // would trade the picture back and forth with the HLS player.
      setFailedEndpoint(endpoint);
      if (pictured) {
        require('../libs/errorReporter').reportError('LiveStreamPlayer', ['WebRTC playback fell back to HLS'], {
          level: 'info',
          metadata: { playbackId, reason },
        });
      }
    };

    const start = async () => {
      try {
        const { subscribeToWhep } = await import('../libs/whep');
        if (cancelled) return;
        const opened = await subscribeToWhep({
          endpoint,
          onStateChange: (state) => {
            if (cancelled) return;
            if (state === 'playing') {
              connected = true;
              clearTimeout(connectTimer);
            }
            if (state === 'failed') giveUp('connection lost');
            // ICE can sit in "disconnected" for half a minute before it calls
            // it failed; the watchdog below moves on well before that.
            reconnectingSince = state === 'reconnecting' ? reconnectingSince || Date.now() : 0;
          },
        });
        if (cancelled) {
          await opened.stop();
          return;
        }
        session = opened;
        setAttached({ endpoint, stream: opened.stream });
        watchForFreeze(opened);
        if (!connected) {
          connectTimer = setTimeout(() => {
            if (cancelled || connected || pictured) return;
            // The server answered and the media never arrived: this network
            // does not carry WebRTC. Skip it for a while, on every stream.
            rememberWebRtcBlocked();
            giveUp('no media route');
          }, CONNECT_TIMEOUT_MS);
        }
      } catch (e) {
        if (cancelled) return;
        // The server said no to this stream (one WebRTC cannot carry): the
        // next open goes straight to HLS. Not for a 404, which is a stream
        // between two broadcasts.
        const refused = e as { name?: string; status?: number } | null;
        if (refused?.name === 'WhepRefusedError' && refused.status !== 404) rememberWhepSilent(playbackId);
        giveUp('subscribe failed');
      }
    };

    const watchForFreeze = (session: WhepSubscription) => {
      let lastFrames = -1;
      let lastMovedAt = Date.now();
      let checking = false;
      watchdog = setInterval(() => {
        if (cancelled || checking) return;
        // A phone in the background stops drawing, and the count with it.
        if (AppState.currentState !== 'active' || pausedRef.current) {
          lastMovedAt = Date.now();
          return;
        }
        const now = Date.now();
        if (reconnectingSince && now - reconnectingSince >= WHEP_FROZEN_MS && lastMovedAt <= reconnectingSince) {
          giveUp('reconnect timed out');
          return;
        }
        if (!pictured) return;
        checking = true;
        void session.framesDecoded().then((frames) => {
          checking = false;
          if (cancelled || AppState.currentState !== 'active' || pausedRef.current || frames == null) return;
          if (frames !== lastFrames) {
            lastFrames = frames;
            lastMovedAt = Date.now();
          } else if (Date.now() - lastMovedAt >= WHEP_FROZEN_MS) {
            giveUp('frozen picture');
          }
        });
      }, WHEP_FROZEN_CHECK_MS);
    };

    timer = setTimeout(() => {
      // No picture by now: the negotiation never finished or the media leg
      // never arrived. Remember it so the next open goes straight to HLS.
      if (cancelled || pictured) return;
      rememberWhepSilent(playbackId);
      giveUp('no picture');
    }, START_TIMEOUT_MS);

    void start();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(connectTimer);
      clearInterval(watchdog);
      pictureRef.current = () => undefined;
      setAttached(null);
      void session?.stop();
    };
  }, [endpoint, playbackId]);

  // The sound switch belongs to the track, not to a player: there is no
  // element in between to mute. Applied on every change, and on first attach.
  useEffect(() => {
    if (!media) return;
    for (const track of media.getAudioTracks()) {
      track.enabled = !muted;
    }
  }, [media, muted]);

  return { stream: media, failed: failed || silentBefore, pending: !!endpoint && !media && !failed, onPicture };
}

export default useWhepStream;
