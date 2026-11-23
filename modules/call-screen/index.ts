/**
 * The phone's own incoming call screen: CallKit on iPhone (woken by VoIP
 * pushes), a full screen ringing notification on Android.
 *
 * Optional throughout: a binary built before this module has no native side,
 * so every call here quietly does nothing and OTA updates stay safe on older
 * installs.
 */
export type CallScreenAction = {
  action: "answer" | "decline" | "hangup" | "incoming" | "token" | "mute";
  requestId?: string;
  muted?: "true" | "false";
  sessionId?: string;
  callType?: string;
  token?: string;
};

type Native = {
  supported?: boolean;
  getVoipToken: () => Promise<string | null>;
  takePendingActions: () => Promise<CallScreenAction[]>;
  endCall: (sessionId: string) => Promise<void>;
  completeDecline?: (workId: string, success: boolean) => Promise<void>;
  completeMute?: (requestId: string, applied: boolean) => Promise<void>;
  requestUnlock: () => Promise<void>;
  addListener: (event: "onCallAction", fn: (e: CallScreenAction) => void) => { remove: () => void };
};

let cached: Native | null | undefined;
function native(): Native | null {
  if (cached !== undefined) return cached;
  try {
    const { requireOptionalNativeModule } = require("expo-modules-core") as {
      requireOptionalNativeModule: (name: string) => Native | null;
    };
    cached = requireOptionalNativeModule("RiftnCallScreen");
  } catch {
    cached = null;
  }
  return cached;
}

/** True when this binary has the phone call screen. */
export function callScreenSupported(): boolean {
  return native()?.supported === true;
}

export async function getVoipToken(): Promise<string | null> {
  try { return (await native()?.getVoipToken()) ?? null; } catch { return null; }
}

export async function takePendingCallActions(): Promise<CallScreenAction[]> {
  try { return (await native()?.takePendingActions()) ?? []; } catch { return []; }
}

/** The app answered, ended or is ringing this call itself: close the phone's call screen for it. */
export function endNativeCall(sessionId: string): void {
  try { void native()?.endCall(sessionId)?.catch(() => {}); } catch {}
}

/** Android: ask to unlock after answering over the lock screen. */
export function requestUnlock(): void {
  try { void native()?.requestUnlock()?.catch(() => {}); } catch {}
}

export function addCallScreenListener(fn: (action: CallScreenAction) => void): () => void {
  const module = native();
  if (!module || typeof module.addListener !== "function") return () => {};
  try {
    const sub = module.addListener("onCallAction", fn);
    return () => { try { sub.remove(); } catch {} };
  } catch {
    return () => {};
  }
}

export function completeNativeMute(requestId: string, applied: boolean): void {
  void native()?.completeMute?.(requestId, applied).catch(() => {});
}

export async function completeNativeDecline(workId: string, success: boolean): Promise<void> {
  await native()?.completeDecline?.(workId, success);
}
