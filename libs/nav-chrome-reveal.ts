/**
 * Arriving on a screen shows its bars
 * ===================================
 * Scrolling down hides the top header and the bottom nav. That state lives
 * with the screen, so going Back (arrow, swipe, Android back) to a screen that
 * was scrolled used to land on it with both bars still away: back from a
 * profile to the feed and there was no way to see where you were.
 *
 * Every hide-on-scroll hook registers here, and `revealNavChrome()` runs when
 * the focused screen changes and when an in-place layer on Home (a profile,
 * a post, the photo sheet) closes. The bars come back; the reader's next
 * deliberate scroll hides them again as usual.
 */
type Reveal = () => void;

const reveals = new Set<Reveal>();

export function onRevealNavChrome(reveal: Reveal): () => void {
  reveals.add(reveal);
  return () => {
    reveals.delete(reveal);
  };
}

export function revealNavChrome(): void {
  reveals.forEach((reveal) => {
    try {
      reveal();
    } catch {
      // One screen's bars must never stop another's.
    }
  });
}

/**
 * Pulls out the focused route's key from a navigation state, so a change of
 * screen can be told apart from a params update on the same one.
 */
export function focusedRouteKey(state: unknown): string | undefined {
  let node = state as { index?: number; routes?: Array<{ key?: string; state?: unknown }> } | undefined;
  let key: string | undefined;
  while (node?.routes?.length) {
    const route = node.routes[node.index ?? node.routes.length - 1];
    if (!route) break;
    key = route.key;
    node = route.state as typeof node;
  }
  return key;
}
