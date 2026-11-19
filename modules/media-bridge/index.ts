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
  showBroadcastPicker?: () => Promise<boolean>;
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

/** iOS: opens the system "Start Broadcast" sheet on the app's extension. */
export async function showBroadcastPicker(): Promise<boolean> {
  try { return (await bridge()?.showBroadcastPicker?.()) === true; } catch { return false; }
}
