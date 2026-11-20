import { apiClient } from "../libs/api.client";

export type AssistantActionKind = "react" | "follow" | "unfollow" | "chat_access";
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
  };
  result: {
    done?: number;
    total?: number;
    added?: number;
    ok?: number;
    allowed?: boolean;
    used?: Record<string, number>;
  } | null;
  confirmBy: string;
}

const path = (id: string) => `/assistant-actions/${encodeURIComponent(id)}`;
const unwrap = (res: any): AssistantAction => res?.data?.id ? res.data : res;

export const getAssistantAction = async (id: string) =>
  unwrap(await apiClient.get(path(id), { isAuthRequired: true }));

export const confirmAssistantAction = async (id: string, reaction?: string) =>
  unwrap(await apiClient.post(`${path(id)}/confirm`, reaction ? { reaction } : {}, { isAuthRequired: true }));

export const cancelAssistantAction = async (id: string) =>
  unwrap(await apiClient.post(`${path(id)}/cancel`, {}, { isAuthRequired: true }));
