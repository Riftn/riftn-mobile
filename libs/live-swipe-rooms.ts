import { isVerticalFeedLive } from "./live-shorts";
import type { LiveStreamEntity } from "../services/live.service";

/** Public room destinations in the same order as the Live list. The next
 * player loads its own playback URL, access decision and chat membership. */
export function swipeRooms(rows: LiveStreamEntity[], blocked: (address?: string) => boolean) {
  const seen = new Set<string>();
  const rooms: { streamId: string; tokenId?: number; isLive: true }[] = [];
  for (const row of rows) {
    const id = row?._id ?? row?.streamId;
    if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id) || seen.has(id)) continue;
    if (blocked(row.address) || blocked(row.account?.address)) continue;
    // The public list serves JSON strings as well as parsed metadata.
    let info = row.streamInfo;
    if (typeof info === "string") {
      try {
        info = JSON.parse(info);
      } catch {
        continue;
      }
    }
    if (info != null && (typeof info !== "object" || Array.isArray(info))) continue;
    if (!isVerticalFeedLive({ ...row, streamInfo: info }) || row.plansDetails?.length || row.isPrivate || row.isUnlisted ||
        (row.visibility && row.visibility !== "public") || info?.subscriberPlans?.length) continue;
    seen.add(id);
    rooms.push({ streamId: id, tokenId: row.tokenId, isLive: true });
  }
  return rooms;
}
