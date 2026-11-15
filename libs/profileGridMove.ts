/**
 * Applying one drag on the profile grid to the creator's whole saved order.
 *
 * The grid holds only the pages scrolled so far, and a save replaces the full
 * list. So the moved post is taken out of the full order and put back right
 * after the nearest post before its new place that the order knows (a
 * scheduled post on your own grid is not part of it yet).
 */

/** `before`: the posts ahead of the new place, nearest first. None known puts it first. */
export function moveInOrder(order: number[], moved: number, before: number[]): number[] | null {
  if (!order.includes(moved)) return null;
  const next = order.filter((id) => id !== moved);
  const anchor = before.find((id) => id !== moved && next.includes(id));
  if (anchor === undefined) return [moved, ...next];
  next.splice(next.indexOf(anchor) + 1, 0, moved);
  return next;
}

/** The posts ahead of place `to` once the post at `from` has moved there, nearest first. */
export function postsBefore<T>(items: (T | undefined)[], from: number, to: number): T[] {
  const out: T[] = [];
  // Moving later, the post now at `to` ends up just ahead of it.
  for (let i = to > from ? to : to - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (i !== from && item !== undefined) out.push(item);
  }
  return out;
}
