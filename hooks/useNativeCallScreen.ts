import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { UseCallReturn } from "./useCall";
import {
  addCallScreenListener,
  callScreenSupported,
  completeNativeMute,
  endNativeCall,
  requestUnlock,
  takePendingCallActions,
  type CallScreenAction,
} from "../modules/call-screen";
import { refreshPushRegistration } from "../services/push/push.service";

/**
 * Connects the phone's call screen (CallKit / Android call notification) to
 * the app's calls: Answer and Decline there answer or decline here, and when
 * the app shows, answers or ends a call itself, the phone's screen closes.
 */
export function useNativeCallScreen(call: UseCallReturn): void {
  const callRef = useRef(call);
  callRef.current = call;

  useEffect(() => {
    if (!callScreenSupported()) return;
    const handle = (event: CallScreenAction) => {
      const sessionId = event.sessionId;
      const current = callRef.current;
      switch (event.action) {
        case "answer":
          if (sessionId) void current.acceptCallById(sessionId);
          break;
        case "decline":
          if (sessionId) void current.declineCallById(sessionId);
          break;
        case "hangup":
          if (sessionId && current.currentCall?.id === sessionId) current.endCall();
          break;
        case "mute":
          if (event.requestId) {
            const applied = !!sessionId && (event.muted === "true" || event.muted === "false")
              && current.setNativeMute(sessionId, event.muted === "true");
            completeNativeMute(event.requestId, applied);
          }
          break;
        case "token":
          void refreshPushRegistration();
          break;
        default:
          break;
      }
    };
    const drain = () => {
      void takePendingCallActions().then(actions => actions.forEach(handle));
    };
    const remove = addCallScreenListener(handle);
    drain();
    const app = AppState.addEventListener("change", state => { if (state === "active") drain(); });
    return () => { remove(); app.remove(); };
  }, []);

  // Close the phone's call screen once the app has the call in hand.
  const sessionId = call.currentCall?.id;
  const inApp = call.isIncoming;
  const lastRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!callScreenSupported()) return;
    const previous = lastRef.current;
    lastRef.current = sessionId && sessionId !== "pending" ? sessionId : undefined;
    // A call that finished: end it on the phone's screen too.
    if (previous && previous !== lastRef.current) endNativeCall(previous);
    // The app's own ringing screen is up: stop the phone's ring so it doesn't ring twice.
    if (lastRef.current && inApp) endNativeCall(lastRef.current);
  }, [sessionId, inApp]);

  // Answered in the app while showing over the lock screen (Android): unlock first.
  const connecting = call.isConnecting && !call.isIncoming && call.currentCall?.status === "connected";
  useEffect(() => {
    if (connecting) requestUnlock();
  }, [connecting]);
}
