import { useSyncExternalStore } from "react";
import { useAuthState, useUser } from "../context/AuthContext";
import { storage } from "./storage";

const KEY = "riftn.blurMomentPreviews";
const listeners = new Set<() => void>();
const sessionValues = new Map<string, boolean>();

function read(key: string): boolean | undefined {
  const sessionValue = sessionValues.get(key);
  if (sessionValue !== undefined) return sessionValue;
  try {
    return storage.getBoolean(key);
  } catch { /* Keep the current choice if device storage is unavailable. */ }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMomentPreviewSetting() {
  const user = useUser();
  const { isBootLoading, isLoading } = useAuthState();
  const wallet = (user?.walletAddress || user?.address)?.toLowerCase();
  const key = wallet ? `${KEY}:${wallet}` : KEY;
  // Preserve the old device-wide setting until this account has its own choice.
  const readValue = () => read(key) ?? read(KEY) ?? false;
  const blurred = useSyncExternalStore(subscribe, readValue, () => false);
  const setBlurred = (next: boolean) => {
    try {
      storage.set(key, next);
      sessionValues.delete(key);
    } catch {
      sessionValues.set(key, next);
    }
    listeners.forEach(listener => listener());
  };
  return { blurred, loading: isBootLoading || isLoading, setBlurred };
}

export function useMomentPreviewsBlurred(): boolean {
  const { blurred, loading } = useMomentPreviewSetting();
  return blurred || loading;
}
