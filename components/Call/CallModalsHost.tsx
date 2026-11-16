import React from "react";
import { useCall } from "../../context/CallContext";
export default function CallModalsHost() {
  const { currentCall, isIncoming, callSummary } = useCall();
  if (!currentCall) {
    if (!callSummary) return null;
    const Ended = require('./CallEndedScreen').default;
    return <Ended />;
  }
  const Incoming = isIncoming ? require('./IncomingCallModal').default : null;
  const Active = currentCall.call_type === 'video'
    ? require('./VideoCallModal').default : require('./VoiceCallModal').default;
  return <>{Incoming && <Incoming />}<Active /></>;
}
