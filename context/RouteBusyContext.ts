import { createContext, useContext, useEffect } from 'react';

/**
 * Lets a page tell its route that it is still showing its own first loading
 * state. The route keeps its loading shell over the page until then (for a
 * short, capped time), so the shell is followed by the page itself and not by
 * a second placeholder.
 *
 * Only a page's main placeholder holds the route (a page loader, a list or
 * profile skeleton). Small ones inside a ready page (comments, link cards, a
 * shelf further down) never do: the page shows as soon as it has its content.
 */
export interface RouteBusy {
  /** Call while a page-sized loader is mounted; returns the release. */
  hold(): () => void;
}

export const RouteBusyContext = createContext<RouteBusy | null>(null);

/** Mark the surrounding route busy for as long as the caller is mounted. */
export function useRouteBusy(active = true): void {
  const busy = useContext(RouteBusyContext);
  useEffect(() => (active && busy ? busy.hold() : undefined), [active, busy]);
}

/** Drop inside a page's own main placeholder: holds the route while it is mounted. */
export function RouteBusyMark(): null {
  useRouteBusy();
  return null;
}
