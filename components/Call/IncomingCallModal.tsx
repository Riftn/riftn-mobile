import React from "react";
import { useTranslation } from "react-i18next";
import { useCall } from "../../context/CallContext";
import { CallStage, CallIdentity, CallPill, CallFoot, CallRow } from "./CallChrome";
import { usePeerIdentity } from "./usePeerIdentity";

const IncomingCallModal: React.FC = () => {
  const { isIncoming, currentCall, acceptCall, rejectCall, peerAddress } = useCall();
  const { t } = useTranslation();
  const peer = usePeerIdentity(peerAddress);

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
          <CallPill icon="PhoneOff" label={t("calls.decline")} onPress={rejectCall} />
          <CallPill icon={isVideo ? "Video" : "Phone"} label={t("calls.accept")} onPress={acceptCall} solid />
        </CallRow>
      </CallFoot>
    </CallStage>
  );
};

export default IncomingCallModal;
