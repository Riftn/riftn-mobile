import { apiClient } from "../libs/api.client";

/** A person tagged on one photo of a post. x and y run 0..1 across the photo. */
export interface PhotoTag {
  address?: string;
  username: string;
  /** Which photo of the post (0 = first). */
  i: number;
  x: number;
  y: number;
}

/** Owner only: replace the post's tags. Newly tagged people get a notification. */
export async function setPhotoTags(tokenId: number, tags: PhotoTag[]): Promise<{ imageTags: PhotoTag[] }> {
  return apiClient.post(
    "/photo_tags",
    { tokenId, tags: tags.map(({ username, i, x, y }) => ({ username, i, x, y })) },
    { isAuthRequired: true },
  );
}

/** Take yourself off a post you were tagged in. */
export async function removeMyPhotoTag(tokenId: number): Promise<{ imageTags: PhotoTag[] }> {
  return apiClient.post("/photo_tags/remove_me", { tokenId }, { isAuthRequired: true });
}
