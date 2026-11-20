/**
 * State updater for a measured height that ignores changes under 1pt.
 *
 * The sign-in screens size the clip lanes from the form's measured height,
 * and moving the form re-rounds its edges to the pixel grid, so its height
 * comes back a fraction of a point different. Feeding that back flipped the
 * lanes between two heights every frame and the whole form shook. Real
 * changes (a field opening, an error line) are always bigger than 1pt.
 *
 *   onLayout={(e) => setHeight(steadyHeight(e.nativeEvent.layout.height))}
 */
export function steadyHeight(next: number) {
  return (prev: number | undefined): number =>
    prev !== undefined && Math.abs(prev - next) < 1 ? prev : next;
}
