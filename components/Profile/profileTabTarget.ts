/**
 * Where to put a profile tab that is being switched to, so the header does
 * not move: while the header is in view (above pinAt) the new tab opens at the
 * same height; once the tab bar is pinned it stays pinned, with the new tab
 * just under it or where it was left, if that is lower.
 */
export function profileTabTarget(current: number, saved: number | undefined, pinAt: number): number {
  'worklet';
  if (pinAt <= 0) return saved ?? 0;
  if (current < pinAt - 4) return Math.max(0, current);
  return Math.max(saved ?? pinAt, pinAt);
}
