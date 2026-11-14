import { findUnreadAnchor } from "../libs/chatUnreadAnchor";

const at = (s: number) => new Date(1_000_000 + s * 1000).toISOString();
const OPEN = 1_000_000 + 100 * 1000;

describe("findUnreadAnchor", () => {
  it("is null with nothing unread", () => {
    expect(findUnreadAnchor([{ id: "a", mine: false, createdAt: at(1) }], 0, OPEN)).toBeNull();
  });

  it("counts the other side's lines back from the newest", () => {
    const a = findUnreadAnchor([
      { id: "e", mine: false, createdAt: at(50) },
      { id: "d", mine: true, createdAt: at(40) },
      { id: "c", mine: false, createdAt: at(30) },
      { id: "b", mine: false, createdAt: at(20) },
    ], 2, OPEN);
    expect(a).toEqual({ id: "c", ids: ["e", "c"], count: 2 });
  });

  it("ignores lines that arrived after opening", () => {
    const a = findUnreadAnchor([
      { id: "new", mine: false, createdAt: at(500) },
      { id: "b", mine: false, createdAt: at(20) },
      { id: "a", mine: false, createdAt: at(10) },
    ], 1, OPEN);
    expect(a?.id).toBe("b");
  });

  it("stops at the oldest loaded line and keeps the full count", () => {
    const a = findUnreadAnchor([{ id: "a", mine: false, createdAt: at(1) }], 40, OPEN);
    expect(a).toEqual({ id: "a", ids: ["a"], count: 40 });
  });
});
