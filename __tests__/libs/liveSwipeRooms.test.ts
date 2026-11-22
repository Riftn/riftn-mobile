jest.mock("../../libs/live-ingest", () => ({ hlsUrlFor: (r: any) => r.playbackId || null }));
jest.mock("../../libs/misc", () => ({}));

import type { LiveStreamEntity } from "../../services/live.service";
import { swipeRooms } from "../../libs/live-swipe-rooms";

const row = (id: number, extra = {}) => ({
  _id: String(id).padStart(24, "0"), status: "LIVE", playbackId: "public",
  address: "creator", tokenId: id, ...extra,
} as LiveStreamEntity);

it("keeps public rooms in order and gives the next player only its own route identifiers", () => {
  const first = row(1, { streamKey: "ignored" });
  const second = row(2);
  expect(swipeRooms([first, first, second], () => false)).toEqual([
    { streamId: first._id, tokenId: 1, isLive: true },
    { streamId: second._id, tokenId: 2, isLive: true },
  ]);
});

it("skips unavailable, gated, blocked and malformed rows before choosing neighbors", () => {
  const excluded = [
    { status: "ENDED" }, { status: "SCHEDULED" }, { playbackId: null },
    { plansDetails: [{}] }, { streamInfo: { isPayPerView: true } },
    { streamInfo: '{"isPayPerView":true}' }, { contentRating: "mature" },
    { address: "blocked" }, { account: { address: "blocked" } },
    { isPrivate: true }, { visibility: "unlisted" }, { _id: "12" },
  ];
  expect(swipeRooms(excluded.map((extra, i) => row(i, extra)), a => a === "blocked")).toEqual([]);
});
