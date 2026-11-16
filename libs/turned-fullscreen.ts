/**
 * Full screen opened by turning the phone sideways closes when the phone is
 * turned upright again. Whoever opened it reads this once on coming back: only
 * then is it safe to start following the phone's turn again. After a close by
 * the Back button the phone is still sideways, and following it straight away
 * would reopen full screen.
 */
let closedUpright = false;

export function noteFullscreenClosedUpright(): void {
  closedUpright = true;
}

export function takeFullscreenClosedUpright(): boolean {
  const value = closedUpright;
  closedUpright = false;
  return value;
}
