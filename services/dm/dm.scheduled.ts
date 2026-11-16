import { apiClient } from "../../libs/api.client";

/** A direct message written now and sent later (GET /dm/scheduled). */
export interface ScheduledDm {
  _id: string;
  dmId: string;
  /** Plain text, or the sealed envelope when the chat is encrypted. */
  content: string;
  replyTo: string | null;
  /** UTC instant, ISO. Shown in the viewer's own zone. */
  sendAt: string;
  /** Zone of the device that picked the time. */
  timeZone: string | null;
  status: "scheduled" | "failed";
  failureCode: string | null;
  failureReason: string | null;
  createdAt: string | null;
}

const deviceZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

export async function listScheduledDms(dmId: string): Promise<ScheduledDm[]> {
  const res = await apiClient.get<{ result: ScheduledDm[] }>(`/dm/scheduled?dmId=${encodeURIComponent(dmId)}`, { isAuthRequired: true });
  return res?.result || [];
}

export async function scheduleDm(input: { dmId: string; content: string; sendAt: Date; replyTo?: string | null }): Promise<ScheduledDm> {
  const res = await apiClient.post<{ result: ScheduledDm }>(
    "/dm/scheduled",
    {
      dmId: input.dmId,
      content: input.content,
      sendAt: input.sendAt.toISOString(),
      timeZone: deviceZone(),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    },
    { isAuthRequired: true },
  );
  return res.result;
}

/** Change the words, the time ("now" sends it straight away), or both. */
export async function updateScheduledDm(id: string, patch: { content?: string; sendAt?: Date | "now" }): Promise<ScheduledDm> {
  const res = await apiClient.patch<{ result: ScheduledDm }>(
    `/dm/scheduled/${encodeURIComponent(id)}`,
    {
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.sendAt !== undefined
        ? { sendAt: patch.sendAt === "now" ? "now" : patch.sendAt.toISOString(), timeZone: deviceZone() }
        : {}),
    },
    { isAuthRequired: true },
  );
  return res.result;
}

export async function cancelScheduledDm(id: string): Promise<void> {
  await apiClient.delete(`/dm/scheduled/${encodeURIComponent(id)}`, { isAuthRequired: true });
}
