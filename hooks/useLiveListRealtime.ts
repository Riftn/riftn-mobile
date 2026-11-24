import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import env from '../config/env';
import { useAuthState } from '../context/AuthContext';
import { useWebSocketApi, useWebSocketStatus } from '../context/WebSocketContext';
import { LivestreamEvents } from '../services/enums/livestream.enum';

/** Every live surface reads a query under this key (liveStreamsQuery and its siblings). */
export const LIVE_LIST_KEY = ['dehub-live-streams'] as const;

/**
 * Every open app hears the same ping at the same moment. Spreading the
 * re-read over a second keeps a go-live from landing as one burst on /live,
 * and still reads as instant to anyone looking at the row.
 */
export const LIVE_LIST_REFRESH_SPREAD_MS = 900;

/**
 * Keep every live surface current the moment someone goes live or ends.
 *
 * The Moments row's live tiles, the Live now chip, the Live tab and the live
 * ring on faces all read `/live`, and the app only asked again when a screen
 * mounted after the minute-long staleTime, so a new live could stay missing
 * (and an ended one stay LIVE) until something remounted. The backend now
 * pings every socket when the list changes; this re-reads it. The Moments
 * row follows by itself: a new set of live hosts refetches the shelf.
 *
 * Signed in, the ping rides the app's core socket. Signed out there is no
 * core socket, so a small one is held while the app is in the foreground.
 * Coming back to the foreground or reconnecting re-reads too, since a ping
 * sent while the app was away is gone.
 */
export function useLiveListRealtime() {
  const queryClient = useQueryClient();
  const { isSignedIn } = useAuthState();
  const { on } = useWebSocketApi();
  const { connectionEpoch } = useWebSocketStatus();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  refreshRef.current = () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      void queryClient.invalidateQueries({ queryKey: LIVE_LIST_KEY });
    }, Math.floor(Math.random() * LIVE_LIST_REFRESH_SPREAD_MS));
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setForeground(active);
      if (active) refreshRef.current();
    });
    return () => {
      subscription.remove();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  // Signed in: the shared core socket. `on` holds the handler until it is up.
  useEffect(() => {
    if (!isSignedIn) return;
    return on(LivestreamEvents.LiveListChanged, () => refreshRef.current());
  }, [isSignedIn, on]);

  // A core reconnect (not the first connect) may have missed a ping.
  const seenEpoch = useRef(connectionEpoch);
  useEffect(() => {
    if (!isSignedIn) return;
    if (connectionEpoch > 1 && connectionEpoch !== seenEpoch.current) refreshRef.current();
    seenEpoch.current = connectionEpoch;
  }, [isSignedIn, connectionEpoch]);

  // Signed out: a small socket of its own while the app is on screen.
  useEffect(() => {
    if (isSignedIn || !foreground) return;
    const socket = io((env.WEBSOCKET_URL || 'https://api.dehub.io').replace(/\/socket\.io\/?$/i, ''), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
    });
    let connectedBefore = false;
    socket.on('connect', () => {
      if (connectedBefore) refreshRef.current();
      connectedBefore = true;
    });
    socket.on(LivestreamEvents.LiveListChanged, () => refreshRef.current());
    return () => { socket.disconnect(); };
  }, [isSignedIn, foreground]);
}

/** Mounted once inside WebSocketProvider. Renders nothing. */
export function LiveListRealtime() {
  useLiveListRealtime();
  return null;
}
