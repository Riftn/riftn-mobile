import { useCallback, useState } from 'react';

/**
 * A search box's text for this run of the app only. It survives moving
 * between screens, and is gone once the app is closed: a search that ended
 * should not greet you next time with a half-filtered menu.
 */
const memory = new Map<string, string>();

export function useSessionText(key: string, initial = ''): [string, (next: string) => void] {
  const [value, setValue] = useState(() => memory.get(key) ?? initial);
  const set = useCallback((next: string) => {
    if (next) memory.set(key, next); else memory.delete(key);
    setValue(next);
  }, [key]);
  return [value, set];
}
