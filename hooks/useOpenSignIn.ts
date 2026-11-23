import { useCallback } from "react";
import { useAuthActions } from "../context/AuthContext";

/**
 * Opens the sign-in sheet, the same one a signed-out like, follow or comment
 * opens, and runs `then` once signed in.
 */
export function useOpenSignIn(): (then?: () => void) => void {
  const { requireAuth } = useAuthActions();
  return useCallback((then?: () => void) => requireAuth(then ?? (() => {})), [requireAuth]);
}
