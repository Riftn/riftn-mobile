jest.mock("../../libs/api.client", () => ({ apiClient: { fetch: jest.fn(async () => null), post: jest.fn(async () => ({ success: true })) } }));

import { readCallModeration, removedMinutesLeft } from "../../libs/groupCallModeration";

describe("group call moderation", () => {
  it("counts the minutes a removed person still waits, rounded up", () => {
    const now = Date.parse("2026-11-24T20:00:00Z");
    const moderation = { muted: [], removed: [{ wallet: "0xabc", until: "2026-11-24T20:14:10Z" }], canModerate: false };
    expect(removedMinutesLeft(moderation, "0xABC", now)).toBe(15);
    expect(removedMinutesLeft(moderation, "0xdef", now)).toBe(0);
    expect(removedMinutesLeft(moderation, "0xabc", Date.parse("2026-11-24T20:15:00Z"))).toBe(0);
  });

  it("reads an empty answer as nobody muted and no moderator rights", async () => {
    await expect(readCallModeration("g")).resolves.toEqual({ muted: [], removed: [], canModerate: false });
  });
});
