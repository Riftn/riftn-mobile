/**
 * Says whether the reader is close enough to the end of "More posts" for
 * another card to be worth drawing. The page that owns the scroll sets it; the
 * list reads it without that page having to redraw.
 */
export interface DrawGate {
  get: () => boolean;
  set: (open: boolean) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createDrawGate(initial = true): DrawGate {
  let open = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => open,
    set: (next) => {
      if (next === open) return;
      open = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** For a list nobody gates: every card is drawn as it comes. */
export const ALWAYS_OPEN: DrawGate = { get: () => true, set: () => {}, subscribe: () => () => {} };
