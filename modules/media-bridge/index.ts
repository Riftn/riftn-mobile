/**
 * Native bits that shipped together in one store build: hardware volume key
 * presses ("volume up unmutes the video") and live screen share support.
 *
 * Optional throughout: a binary built before this module never reports a
 * press and says screen share is unavailable, so an over-the-air update stays
 * safe on older installs.
 */
export type VolumeKeyDirection = "up" | "down";

type Bridge = {
  liveScreenShare?: boolean;
  liveBroadcastPublish?: boolean;
  showBroadcastPicker?: (microphone?: boolean) => Promise<boolean>;
  prepareLiveBroadcast?: (url: string) => string | null;
  liveBroadcastStatus?: (id: string) => Record<string, unknown> | null;
  stopLiveBroadcast?: (id: string) => void;
  memoryFootprintMB?: () => number | null;
  addListener: (event: "onVolumeKey", fn: (e: { direction?: string }) => void) => { remove: () => void };
};

let cached: Bridge | null | undefined;
function bridge(): Bridge | null {
  if (cached !== undefined) return cached;
  try {
    const { requireOptionalNativeModule } = require("expo-modules-core") as {
      requireOptionalNativeModule: (name: string) => Bridge | null;
    };
    cached = requireOptionalNativeModule("RiftnMediaBridge");
  } catch {
    cached = null;
  }
  return cached;
}

export function addVolumeKeyListener(fn: (direction: VolumeKeyDirection) => void): () => void {
  const native = bridge();
  if (!native || typeof native.addListener !== "function") return () => {};
  try {
    const sub = native.addListener("onVolumeKey", (e) => {
      if (e?.direction === "up" || e?.direction === "down") fn(e.direction);
    });
    return () => { try { sub.remove(); } catch {} };
  } catch {
    return () => {};
  }
}

/** True when this binary can share its screen into a live stream. */
export function liveScreenShareSupported(): boolean {
  return bridge()?.liveScreenShare === true;
}

/**
 * iOS: opens the system "Start Broadcast" sheet on the app's extension.
 * `microphone` shows the sheet's Microphone switch (only when the extension
 * publishes the share itself and so carries the voice).
 */
export async function showBroadcastPicker(microphone = false): Promise<boolean> {
  try {
    const native = bridge();
    if (!native?.showBroadcastPicker) return false;
    return (await (microphone ? native.showBroadcastPicker(true) : native.showBroadcastPicker())) === true;
  } catch {
    return false;
  }
}

/**
 * iPhone builds whose broadcast extension publishes a live screen share
 * itself, straight to the stream's ingest, instead of handing frames to the
 * app (where iOS stops the video encoder as soon as the creator leaves Riftn).
 */
export function liveBroadcastPublishSupported(): boolean {
  const native = bridge();
  return native?.liveBroadcastPublish === true
    && typeof native.prepareLiveBroadcast === "function"
    && typeof native.liveBroadcastStatus === "function"
    && typeof native.stopLiveBroadcast === "function";
}

export type LiveBroadcastState = "connecting" | "live" | "ended" | "failed";

export interface LiveBroadcastStatus {
  state: LiveBroadcastState;
  /** "app" (we stopped it), "system" (Control Center / red bar), "refused:<code>", "network". */
  reason?: string;
  /** The mic is on in the share (its sound is arriving). */
  mic?: boolean;
  appAudio?: boolean;
  bitrate?: number;
  frames?: number;
  /** Seconds since 1970 when the extension last wrote it. */
  at?: number;
}

/** Leaves the extension a ticket to publish to `url`; returns its id. */
export function prepareLiveBroadcast(url: string): string | null {
  try { return bridge()?.prepareLiveBroadcast?.(url) ?? null; } catch { return null; }
}

/** What the extension reports for this ticket, or null before it has claimed it. */
export function liveBroadcastStatus(id: string): LiveBroadcastStatus | null {
  try {
    const raw = bridge()?.liveBroadcastStatus?.(id);
    const state = raw?.state;
    if (state !== "connecting" && state !== "live" && state !== "ended" && state !== "failed") return null;
    return {
      state,
      reason: typeof raw?.reason === "string" ? raw.reason : undefined,
      mic: raw?.mic === true,
      appAudio: raw?.appAudio === true,
      bitrate: typeof raw?.bitrate === "number" ? raw.bitrate : undefined,
      frames: typeof raw?.frames === "number" ? raw.frames : undefined,
      at: typeof raw?.at === "number" ? raw.at : undefined,
    };
  } catch {
    return null;
  }
}

/** Asks the extension to end this share. */
export function stopLiveBroadcast(id: string): void {
  try { bridge()?.stopLiveBroadcast?.(id); } catch {}
}

/** The app's memory in MB, or null on a binary built before this was added. */
export function memoryFootprintMB(): number | null {
  try {
    const value = bridge()?.memoryFootprintMB?.();
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
