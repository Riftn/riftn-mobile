import type { WebSocketApi } from "../../context/WebSocketContext";
import { WEBSITE_LINK } from "../../config/links";
import { apiClient } from "../../libs/api.client";
import { prepareOutgoing } from "../../libs/dm-e2ee/keys";
import { confirmDmSend } from "../../libs/dm-send-confirmation";
import { getDmUserStatus, type DmUserStatus } from "../../services/dm/dm.api";
import { DMSocketEvent } from "../../services/enums/dm-socket-events.enum";
import { checkStoryReply } from "../../services/stories.service";

export async function sendStoryReply(
  id: string, text: string, label: string, sender: string, ws: WebSocketApi,
): Promise<"sent" | "paid-chat"> {
  const { ok, to } = await checkStoryReply(id);
  if (!ok || !to) throw new Error("Moment reply unavailable");

  const raw: DmUserStatus & { data?: DmUserStatus; result?: DmUserStatus } = await getDmUserStatus(to);
  const status = raw.data ?? raw.result ?? raw;
  if (Number(status.perMessageFee) > 0 &&
      !status.freeAccessUsers?.some(address => address.toLowerCase() === sender)) {
    return "paid-chat";
  }

  const conversation = await apiClient.post<{ data?: { _id?: string } }>(
    "/dm/create", { recipientAddress: to }, { isAuthRequired: true },
  );
  const dmId = conversation.data?._id;
  if (!dmId) throw new Error("Could not open the conversation");

  const link = `${WEBSITE_LINK}/moment/${id}?reply=1`;
  const wire = await prepareOutgoing(to, `${label}: ${text}\n${link}`);
  const payload = { dmId, content: wire.content, type: "msg" };
  await confirmDmSend({
    senderAddress: sender,
    on: (event, handler) => ws.on(event, handler),
    emit: () => ws.emitAuthed(DMSocketEvent.SendMessage, payload),
  }, payload);
  return "sent";
}
