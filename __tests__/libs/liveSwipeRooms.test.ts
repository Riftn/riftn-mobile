jest.mock("../../libs/live-ingest", () => ({ hlsUrlFor: (r: any) => r.playbackId || null }));
jest.mock("../../libs/misc", () => ({}));

import type { LiveStreamEntity } from "../../services/live.service";
import { liveSwipeDirection, swipeRooms } from "../../libs/live-swipe-rooms";

const row = (id: number, extra = {}) => ({
  _id: String(id).padStart(24, "0"), status: "LIVE", playbackId: "public",
  address: "creator", tokenId: id, ...extra,
} as LiveStreamEntity);

it("keeps public rooms in order and gives the next player only its own route identifiers", () => {
  const first = row(1, { streamKey: "ignored", startedAt: "2026-11-25T19:02:00Z" });
  const second = row(2, { streamInfo: "{}", startedAt: "2026-11-25T19:01:00Z" });
  expect(swipeRooms([second, first, first], () => false)).toEqual([
    { streamId: first._id, tokenId: 1, isLive: true },
    { streamId: second._id, tokenId: 2, isLive: true },
  ]);
});

it("skips unavailable, gated, blocked and malformed rows before choosing neighbors", () => {
  const excluded = [
    { status: "ENDED" }, { status: "SCHEDULED" }, { playbackId: null },
    { plansDetails: [{}] }, { streamInfo: { isPayPerView: true } },
    { streamInfo: '{"isPayPerView":true}' }, { streamInfo: "invalid" }, { streamInfo: "[]" }, { contentRating: "mature" },
    { address: "blocked" }, { account: { address: "blocked" } },
    { isPrivate: true }, { visibility: "unlisted" }, { _id: "12" },
  ];
  expect(swipeRooms(excluded.map((extra, i) => row(i, extra)), a => a === "blocked")).toEqual([]);
});

it("pages up and down and rejects short or horizontal drags", () => {
  expect(liveSwipeDirection(-8, -52)).toBe(1);
  expect(liveSwipeDirection(8, 52)).toBe(-1);
  expect(liveSwipeDirection(0, 40)).toBeNull();
  expect(liveSwipeDirection(84, -52)).toBeNull();
});
