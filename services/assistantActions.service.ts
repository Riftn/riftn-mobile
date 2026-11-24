import { apiClient } from "../libs/api.client";

export type AssistantActionKind = "react" | "follow" | "unfollow" | "chat_access" | "request_post" | "schedule_posts" | "post_spacing";
export type AssistantActionStatus = "pending" | "running" | "done" | "cancelled" | "failed" | "expired";

export interface AssistantActionPerson {
  address: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
}

export interface AssistantAction {
  id: string;
  kind: AssistantActionKind;
  status: AssistantActionStatus;
  preview: {
    choice?: string;
    count?: number;
    alreadyReacted?: number;
    totalPosts?: number;
    author?: AssistantActionPerson | null;
    people?: AssistantActionPerson[];
    allow?: boolean;
    draft?: {
      title: string;
      description: string;
      category: 'ui_ux' | 'performance' | 'new_feature' | 'bug_fix' | 'integration' | 'other';
    };
    duplicates?: { id: string; title: string }[];
    /** schedule_posts: each planned post (photo is a stored key; at null = straight away). */
    items?: { text: string; photo: string | null; at: string | null }[];
    /** schedule_posts: minutes between posts; post_spacing: the new gap (0 = off). */
    gapMinutes?: number | null;
    before?: number;
  };
  result: {
    done?: number;
    total?: number;
    added?: number;
    ok?: number;
    allowed?: boolean;
    tokenIds?: number[];
    failed?: number;
    gapMinutes?: number;
    requestId?: string;
    used?: Record<string, number>;
  } | null;
  confirmBy: string;
}

const path = (id: string) => `/assistant-actions/${encodeURIComponent(id)}`;
const unwrap = (res: any): AssistantAction => res?.data?.id ? res.data : res;

export const getAssistantAction = async (id: string) =>
  unwrap(await apiClient.get(path(id), { isAuthRequired: true }));

export const confirmAssistantAction = async (id: string, options: { reaction?: string; requestPost?: true } = {}) =>
  unwrap(await apiClient.post(`${path(id)}/confirm`, options, { isAuthRequired: true }));

export const cancelAssistantAction = async (id: string) =>
  unwrap(await apiClient.post(`${path(id)}/cancel`, {}, { isAuthRequired: true }));

/** Personality + chat model, shared by the Assistant screen and the @assistant DM. */
export interface AssistantPrefs {
  style: string;
  model: string;
}

const unwrapPrefs = (res: any): AssistantPrefs => (res?.data?.style ? res.data : res);

export const getAssistantPrefs = async (): Promise<AssistantPrefs> =>
  unwrapPrefs(await apiClient.get("/assistant-actions/prefs", { isAuthRequired: true }));

export const saveAssistantPrefs = async (prefs: Partial<AssistantPrefs>): Promise<AssistantPrefs> =>
  unwrapPrefs(await apiClient.post("/assistant-actions/prefs", prefs, { isAuthRequired: true }));
