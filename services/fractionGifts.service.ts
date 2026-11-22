import { apiClient } from "../libs/api.client";

export interface FractionGiftConfirm {
  success?: boolean;
  pending?: boolean;
  quantity?: number;
}

/**
 * Tell the server about fractions you just sent. It reads the transfer back
 * off-chain and notifies the receiver. `pending` means the transaction is not
 * readable yet, so ask again.
 */
export const confirmFractionGift = (body: { chainId: number; txHash: string; to: string; tokenId: string | number }) =>
  apiClient.post<FractionGiftConfirm>(
    "/fractions/gift",
    { ...body, tokenId: Number(body.tokenId) },
    { isAuthRequired: true },
  );
