import React from "react";
import { useCall } from "../../context/CallContext";
export default function CallModalsHost() {
  const { currentCall, isIncoming, callSummary } = useCall();
  if (!currentCall) {
    if (!callSummary) return null;
    const Ended = require('./CallEndedScreen').default;
    return <Ended />;
  }
  // Subtitles live as long as the call, minimised or not.
  const Captions = require('./CallCaptions').CallCaptionEngine;
  if (currentCall.group_id) {
    const Group = require('./GroupCallModal').default;
    return <><Captions /><Group /></>;
  }
  const Incoming = isIncoming ? require('./IncomingCallModal').default : null;
  const Active = currentCall.call_type === 'video'
    ? require('./VideoCallModal').default : require('./VoiceCallModal').default;
  return <><Captions />{Incoming && <Incoming />}<Active /></>;
}
