import { anchorFromReadSpot, isLaterSpot, type ReadLine } from "../libs/chatReadPosition";

const at = (min: number) => new Date(Date.UTC(2026, 10, 18, 12, min)).toISOString();
const line = (id: string, min: number, mine = false, skip = false): ReadLine => ({ id, mine, at: at(min), skip });

describe("anchorFromReadSpot", () => {
  const lines = [line("a", 1), line("b", 2), line("c", 3), line("d", 4), line("e", 5)];

  it("opens on the line after where you left off", () => {
    expect(anchorFromReadSpot(lines, { messageId: "b", at: at(2) }, false)).toEqual({
      kind: "anchor", anchor: { id: "c", ids: ["c", "d", "e"], count: 3 },
    });
  });

  it("says nothing is unread when you read to the end", () => {
    expect(anchorFromReadSpot(lines, { messageId: "e", at: at(5) }, false)).toEqual({ kind: "none" });
  });

  it("asks for older history when the spot is above the loaded lines", () => {
    expect(anchorFromReadSpot(lines, { messageId: "old", at: at(0) }, true)).toEqual({ kind: "older" });
  });

  it("starts after your own last reply", () => {
    const mixed = [line("a", 1), line("mine", 2, true), line("c", 3), line("d", 4)];
    expect(anchorFromReadSpot(mixed, { messageId: "a", at: at(1) }, false)).toEqual({
      kind: "anchor", anchor: { id: "c", ids: ["c", "d"], count: 2 },
    });
  });

  it("leaves out lines that arrived after the chat opened", () => {
    const opened = Date.parse(at(3)) + 1000;
    expect(anchorFromReadSpot(lines, { messageId: "b", at: at(2) }, false, opened)).toEqual({
      kind: "anchor", anchor: { id: "c", ids: ["c"], count: 1 },
    });
  });

  it("uses the time when the read line was deleted", () => {
    expect(anchorFromReadSpot(lines, { messageId: "gone", at: at(3) }, true)).toEqual({
      kind: "anchor", anchor: { id: "d", ids: ["d", "e"], count: 2 },
    });
  });
});

describe("isLaterSpot", () => {
  it("moves only forward", () => {
    expect(isLaterSpot({ messageId: "b", at: at(2) }, null)).toBe(true);
    expect(isLaterSpot({ messageId: "b", at: at(2) }, { messageId: "a", at: at(1) })).toBe(true);
    expect(isLaterSpot({ messageId: "a", at: at(1) }, { messageId: "b", at: at(2) })).toBe(false);
  });
});
