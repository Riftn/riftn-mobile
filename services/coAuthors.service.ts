import { apiClient } from "../libs/api.client";
import { cleanCoAuthors, setCoAuthorState, type CoAuthorUser } from "../libs/coAuthors";

export interface CoAuthorsPayload {
  tokenId: number;
  max: number;
  coAuthorUsers: CoAuthorUser[];
  pendingCoAuthorUsers?: CoAuthorUser[];
  coAuthorInvited: boolean;
  isCoAuthor: boolean;
}

function remember(res: any): CoAuthorsPayload {
  const data: CoAuthorsPayload = res?.data ?? res;
  if (data?.tokenId != null) {
    setCoAuthorState(data.tokenId, {
      users: cleanCoAuthors(data.coAuthorUsers),
      invited: !!data.coAuthorInvited,
      ...(data.pendingCoAuthorUsers ? { pending: cleanCoAuthors(data.pendingCoAuthorUsers) } : {}),
    });
  }
  return data;
}

const path = (tokenId: string | number) => `/nft/${encodeURIComponent(String(tokenId))}/co-authors`;

export const getCoAuthors = async (tokenId: string | number) =>
  remember(await apiClient.get(path(tokenId), { isAuthRequired: true }));

/** Invite by username or wallet address. */
export const inviteCoAuthor = async (tokenId: string | number, user: string) =>
  remember(await apiClient.post(path(tokenId), { user }, { isAuthRequired: true }));

export const answerCoAuthorInvite = async (tokenId: string | number, accept: boolean) =>
  remember(await apiClient.post(`${path(tokenId)}/respond`, { accept }, { isAuthRequired: true }));

/** The creator removes anyone (or cancels an invite); a co-author removes themselves. */
export const removeCoAuthor = async (tokenId: string | number, address: string) =>
  remember(await apiClient.delete(`${path(tokenId)}/${encodeURIComponent(address)}`, { isAuthRequired: true }));
