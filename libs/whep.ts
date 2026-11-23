/**
 * WHEP subscriber (WebRTC-HTTP Egress Protocol)
 * =============================================
 * Plays a self-hosted live stream over WebRTC instead of HLS.
 *
 * Why the app needs this at all: the self-hosted ingest is a remuxer, not a
 * transcoder, so a broadcast published over WebRTC keeps its OPUS audio all
 * the way into the HLS ladder (`CODECS="avc1.42c01e,opus"`). Android's decoder
 * reads that; Apple's does not, at any layer — AVPlayer is what expo-video and
 * Safari both sit on, so on an iPhone a self-hosted stream is unplayable over
 * HLS no matter which surface asks for it. WebRTC carries Opus natively,
 * because that is the codec it was built around.
 *
 * It is also about a second behind the broadcaster instead of ten to twenty,
 * which is the difference between a tip landing on what the host is doing and
 * on what they were doing before.
 *
 * Mirrors the publisher in components/LiveProducer/WebRTCPublisher.tsx, and
 * the web app's src/lib/livepeer/whep.ts:
 *   POST {endpoint}   Content-Type: application/sdp   body: SDP offer
 *     -> 201 Created, body: SDP answer, Location: session resource
 *   DELETE {resource} ends the session
 *
 * Not every network can carry it — a UDP-hostile carrier, a stream that never
 * went live — so every caller keeps the HLS path as the fallback rather than
 * treating this as the only route.
 */

import { MediaStream, RTCPeerConnection } from 'react-native-webrtc';

export type WhepState = 'connecting' | 'playing' | 'reconnecting' | 'failed' | 'closed';

export interface WhepSubscription {
  /** Render with <RTCView streamURL={stream.toURL()} />. */
  stream: MediaStream;
  stop: () => Promise<void>;
  /**
   * Video frames decoded so far, or null when the stats cannot be read. A
   * count that stops moving while the session claims to be connected is a
   * frozen picture, which no connection state ever reports.
   */
  framesDecoded: () => Promise<number | null>;
}

export interface SubscribeOptions {
  /** Full WHEP endpoint, from whepEndpointFor(). */
  endpoint: string;
  onStateChange?: (state: WhepState, detail?: string) => void;
}

/**
 * Gathering usually finishes in a few hundred ms. The cap stops a network that
 * never reports `complete` — some carrier NATs never do — from hanging the
 * connect forever; whatever candidates exist by then are good enough.
 */
const ICE_GATHERING_TIMEOUT_MS = 3000;

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Short wait after the first candidate, so the rest of its round lands too. */
const ICE_ENOUGH_GRACE_MS = 150;

/**
 * Resolves once there is a candidate to offer, or once the cap elapses.
 *
 * It used to wait for gathering to COMPLETE, which means every STUN server
 * has answered. On a carrier that blocks or delays STUN that never happens,
 * the full cap sat in front of the offer, and the start timeout in
 * useWhepStream ran out before the picture could arrive: the iPhone gave up
 * on WebRTC for a stream that would have played. The ingest has a public
 * address and learns where the phone is from its first connectivity check,
 * so the offer needs no STUN answer in it. The first candidate is enough.
 */
function waitForIceGathering(pc: any): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      try {
        pc.removeEventListener?.('icegatheringstatechange', onChange);
        pc.removeEventListener?.('icecandidate', onCandidate);
      } catch {
        /* the connection is already gone */
      }
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const onCandidate = (event: any) => {
      if (grace || !event?.candidate) return;
      grace = setTimeout(finish, ICE_ENOUGH_GRACE_MS);
    };
    try {
      pc.addEventListener?.('icegatheringstatechange', onChange);
      pc.addEventListener?.('icecandidate', onCandidate);
    } catch {
      finish();
      return;
    }
    const timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
  });
}

/**
 * The playback server answered, and the answer was no: the stream is not on
 * air, or it carries something WebRTC cannot (H.264 with B-frames). Asking
 * again gets the same answer, so the caller goes straight to HLS.
 */
export class WhepRefusedError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`whep ${status}`);
    this.name = 'WhepRefusedError';
    this.status = status;
  }
}

/** The session resource to DELETE on the way out, if the server named one. */
function resolveSessionResource(response: Response, endpoint: string): string | null {
  const location = response.headers.get('Location') || response.headers.get('location');
  if (!location) return null;
  if (/^https?:/i.test(location)) return location;
  try {
    const base = new URL(endpoint);
    return new URL(location, `${base.protocol}//${base.host}`).toString();
  } catch {
    return null;
  }
}

export async function subscribeToWhep({
  endpoint,
  onStateChange,
}: SubscribeOptions): Promise<WhepSubscription> {
  const pc: any = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
  const stream = new MediaStream();
  let resourceUrl: string | null = null;
  let stopped = false;

  const emit = (state: WhepState, detail?: string) => {
    if (stopped && state !== 'closed') return;
    onStateChange?.(state, detail);
  };

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
    if (resourceUrl) {
      try {
        await fetch(resourceUrl, { method: 'DELETE' });
      } catch {
        // The server times the session out on its own; this is tidiness.
      }
    }
    onStateChange?.('closed');
  };

  emit('connecting');

  try {
    // recvonly: this is playback, nothing is ever sent back up — which is also
    // why it needs no camera or microphone permission.
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.addEventListener('track', (event: any) => {
      // One MediaStream for both tracks: handing a view two separate streams
      // renders whichever arrived last and drops the other.
      if (event?.track) stream.addTrack(event.track);
    });

    pc.addEventListener('connectionstatechange', () => {
      switch (pc.connectionState) {
        case 'connected':
          emit('playing');
          break;
        case 'disconnected':
          emit('reconnecting');
          break;
        case 'failed':
          emit('failed', 'connection lost');
          break;
        default:
          break;
      }
    });

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error('no local description');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/sdp' },
      body: sdp,
    });
    if (!response.ok) throw new WhepRefusedError(response.status);

    const answer = await response.text();
    if (!answer.trim()) throw new Error('empty answer');

    resourceUrl = resolveSessionResource(response, endpoint);
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    const framesDecoded = async (): Promise<number | null> => {
      if (stopped) return null;
      try {
        const report: any = await pc.getStats();
        let frames: number | null = null;
        report?.forEach?.((entry: any) => {
          const video = entry?.kind === 'video' || entry?.mediaType === 'video';
          if (entry?.type === 'inbound-rtp' && video && typeof entry.framesDecoded === 'number') {
            frames = Math.max(frames ?? 0, entry.framesDecoded);
          }
        });
        return frames;
      } catch {
        return null;
      }
    };

    return { stream, stop, framesDecoded };
  } catch (error) {
    await stop();
    throw error;
  }
}
