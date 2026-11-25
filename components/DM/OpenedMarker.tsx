/**
 * What a view-once or on-open photo/video leaves in the chat once it has been
 * opened: a small pill with the photo icon, "Opened" and when. Both people
 * see it, so a photo that was sent and seen never vanishes without a trace.
 * The person who got it also has a camera button after a thin line: tap it
 * to answer that photo with a photo or video of your own (sent as a reply to
 * it, so it shows "Replied to your photo"). Same pill as web's OpenedMarker.
 */
import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { formatMessageTime } from "../../libs/date.util";

interface Props {
  kind?: "image" | "video";
  mine: boolean;
  /** When it was opened (falls back to nothing: just "Opened"). */
  openedAt?: string | Date | null;
  /** The person who got it: answer with the camera. */
  onCamera?: () => void;
  onLongPress?: () => void;
  deliveryStatus?: "sending" | "failed" | "sent";
}

const OpenedMarker: React.FC<Props> = ({ kind = "image", mine, openedAt, onCamera, onLongPress, deliveryStatus }) => {
  const { t } = useTranslation();
  const ink = mine ? "#FFFFFF" : "#F4F4F5";
  const when = openedAt ? formatMessageTime(openedAt) : "";
  const label = deliveryStatus === "sending" ? t("dm.sending", "Sending…")
    : deliveryStatus === "failed" ? t("dm.failedToSend", "Failed to send")
    : deliveryStatus === "sent" ? t("dm.openTimer.sent", "Sent")
    : t("dm.openTimer.opened", "Opened");
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      className="flex-row items-center"
      style={{ paddingLeft: 14, paddingRight: onCamera ? 8 : 16, paddingVertical: 8, gap: 12, minWidth: 168 }}
      accessibilityLabel={
        deliveryStatus ? `${t("dm.photo", "Photo")}, ${label}` : kind === "video"
          ? t("dm.opened.videoA11y", { time: when, defaultValue: "Video, opened {{time}}" })
          : t("dm.opened.photoA11y", { time: when, defaultValue: "Photo, opened {{time}}" })
      }
    >
      <Icon name={kind === "video" ? "Video" : "Image"} size={22} color={ink} />
      <View style={{ flexShrink: 1, flexGrow: 1 }}>
        <Text className={`text-[15px] font-semibold ${mine ? "text-white/80" : "text-theme-neutrals-200"}`}>
          {label}
        </Text>
        {when ? (
          <View className="flex-row items-center" style={{ gap: 4, marginTop: 1 }}>
            {mine ? <Icon name="CheckCheck" size={11} color="hsla(0,0%,100%,0.6)" /> : null}
            <Text className={`text-[11px] ${mine ? "text-white/60" : "text-theme-neutrals-400"}`}>
              {mine ? t("dm.opened.seenAt", { time: when, defaultValue: "Seen {{time}}" }) : when}
            </Text>
          </View>
        ) : null}
      </View>
      {onCamera ? (
        <>
          <View style={{ width: 1, alignSelf: "stretch", marginVertical: 4, backgroundColor: "hsla(0,0%,50%,0.35)" }} />
          <Pressable
            onPress={onCamera}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t("dm.opened.replyCamera", "Reply with the camera")}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "hsla(0,0%,50%,0.2)" }}>
              <Icon name="Camera" size={20} color={ink} />
            </View>
          </Pressable>
        </>
      ) : null}
    </Pressable>
  );
};

export default memo(OpenedMarker);
