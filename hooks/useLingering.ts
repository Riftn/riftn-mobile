import { useEffect, useState } from "react";

/**
 * The last non-null `value`, kept for `ms` after it turns null.
 *
 * A sheet that is mounted only while there is something to show
 * (`{item && <Sheet visible />}`) disappears in one frame when `item` clears,
 * because there is nothing left to animate. Rendering from the lingering copy
 * with `visible={item != null}` keeps the sheet and its content on screen long
 * enough to slide away, then drops it.
 */
export function useLingering<T>(value: T | null | undefined, ms = 450): T | null {
  const current = value ?? null;
  const [held, setHeld] = useState<T | null>(current);
  useEffect(() => {
    if (current !== null) {
      setHeld(current);
      return;
    }
    const timer = setTimeout(() => setHeld(null), ms);
    return () => clearTimeout(timer);
  }, [current, ms]);
  return current ?? held;
}
