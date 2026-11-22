import { collapsedUnreadableRows } from "../../libs/dm-e2ee/collapsed-unreadable";

it("leaves one unreadable message individually accessible and expands only selected rows", () => {
  const rows = ["a", "b", "read", "c", "d", "e"].map(_id => ({ _id, undecryptable: _id !== "read" }));
  expect([...collapsedUnreadableRows(rows, new Set())]).toEqual([["a", 2], ["b", 0], ["c", 3], ["d", 0], ["e", 0]]);
  expect([...collapsedUnreadableRows(rows, new Set(["a", "b"]))]).toEqual([["c", 3], ["d", 0], ["e", 0]]);
  expect([...collapsedUnreadableRows([rows[0]], new Set())]).toEqual([]);
  expect([...collapsedUnreadableRows(rows.slice(1), new Set(["b", "c", "d", "e"]))]).toEqual([]);
});
