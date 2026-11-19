import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCall } from "../../context/CallContext";
import { CallStage, CallIdentity, CallPill, CallFoot, CallRow } from "./CallChrome";
import { usePeerIdentity } from "./usePeerIdentity";
import { startCallRingtone, stopCallRingtone } from "../../libs/call-ringtone";

const IncomingCallModal: React.FC = () => {
  const { isIncoming, currentCall, acceptCall, rejectCall, peerAddress } = useCall();
  const { t } = useTranslation();
  const peer = usePeerIdentity(peerAddress);

  // Ring while this screen is up; answering, declining or the caller giving
  // up all take the screen down, which stops it.
  useEffect(() => {
    if (!isIncoming) return;
    startCallRingtone();
    return stopCallRingtone;
  }, [isIncoming]);

  // Back must not decline the call; Accept and Decline are the only exits.
  const ignoreBack = () => {};

  if (!isIncoming) return null;

  const isVideo = currentCall?.call_type === "video";

  return (
    <CallStage peer={peer} onRequestClose={ignoreBack}>
      <CallIdentity
        kindIcon={isVideo ? "Video" : "Phone"}
        kindLabel={isVideo ? t("calls.videoCall") : t("calls.voiceCall")}
        peer={peer}
        status={t("calls.incoming")}
        ringing
      />
      <CallFoot>
        <CallRow>
          <CallPill icon="PhoneOff" label={t("calls.decline")} onPress={() => { stopCallRingtone(); rejectCall(); }} />
          <CallPill icon={isVideo ? "Video" : "Phone"} label={t("calls.accept")} onPress={() => { stopCallRingtone(); void acceptCall(); }} solid />
        </CallRow>
      </CallFoot>
    </CallStage>
  );
};

export default IncomingCallModal;
