import { ScreenNames } from "../navigation/ScreenNames";

/**
 * Guests sign in on the full sign-in page (the one log out lands on), opened
 * over whatever they were looking at. The same UI can run above the
 * navigator while it is starting or when adding a profile.
 *
 * Imperative because the callers (AuthContext, the session hooks) sit above
 * the navigator. App is required lazily so tests of those modules don't pull
 * the whole app in.
 */
export function openSignInPage(): boolean {
  let navigationRef: any;
  try {
    navigationRef = require("../App").navigationRef;
  } catch {
    return false;
  }
  if (!navigationRef?.isReady?.()) return false;
  const current = navigationRef.getCurrentRoute?.()?.name;
  if (current === ScreenNames.SignIn) return true;
  // Signed-out stack (first-run setup, username): not the app's page stack.
  const rootRoute = navigationRef.getRootState?.()?.routes?.[navigationRef.getRootState?.()?.index ?? 0]?.name;
  if (rootRoute && rootRoute !== ScreenNames.App) return false;
  navigationRef.navigate(ScreenNames.App, { screen: ScreenNames.SignIn });
  return true;
}

type Listener = () => void;
const closeListeners = new Set<Listener>();

/** The sign-in page opened over the app went away (signed in or dismissed). */
export function onSignInPageClosed(listener: Listener): () => void {
  closeListeners.add(listener);
  return () => { closeListeners.delete(listener); };
}

export function noteSignInPageClosed(): void {
  closeListeners.forEach((listener) => {
    try { listener(); } catch {}
  });
}
