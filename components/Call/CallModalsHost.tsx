import React from "react";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { ScreenNames } from "../../navigation/ScreenNames";
import type { AppStackParamList } from "../../navigation/types";
import { useCall } from "../../context/CallContext";
import { usePeerIdentity } from "./usePeerIdentity";

function DirectCallScreen() {
  const { currentCall, isIncoming, peerAddress, setMinimized } = useCall();
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const peer = usePeerIdentity(isIncoming ? currentCall?.caller_address || peerAddress : peerAddress);

  if (isIncoming) {
    const Incoming = require('./IncomingCallModal').default;
    return <Incoming peer={peer} />;
  }
  const Active = currentCall?.call_type === 'video'
    ? require('./VideoCallModal').default
    : require('./VoiceCallModal').default;

  const openMessages = () => {
    setMinimized(true);
    navigation.navigate(ScreenNames.Chat, { targetAddress: peerAddress, title: peer.name });
  };
  return <Active peer={peer} onMessage={openMessages} />;
}

export default function CallModalsHost() {
  const { currentCall, callSummary } = useCall();
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
  return <><Captions /><DirectCallScreen /></>;
}
