import { liveCoStreamAction } from "../../services/live-costream";

jest.mock("../../services/supabase", () => ({}));

const room = { id: "room", host_wallet: "host", accepting_requests: true };
const closed = { ...room, accepting_requests: false };
const seat = { id: "seat", stream_id: null };

describe("live co-stream controls", () => {
  it("offers requests to viewers and hides them for the host or a closed room", () => {
    expect(liveCoStreamAction(room, "", null)).toEqual({ kind: "ask", roomId: "room" });
    expect(liveCoStreamAction(room, "host", null)).toBeNull();
    expect(liveCoStreamAction(closed, "viewer", null)).toBeNull();
  });

  it("allows a pending request to be cancelled after the host closes requests", () => {
    expect(liveCoStreamAction(closed, "viewer", { ...seat, status: "requested" }))
      .toEqual({ kind: "cancel", seatId: "seat" });
  });

  it("offers the guest room to invited and approved viewers", () => {
    expect(liveCoStreamAction(closed, "viewer", { ...seat, status: "invited" }))
      .toEqual({ kind: "join", roomId: "room" });
    expect(liveCoStreamAction(closed, "viewer", { ...seat, status: "accepted" }))
      .toEqual({ kind: "join", roomId: "room" });
    expect(liveCoStreamAction(room, "viewer", { ...seat, status: "accepted", stream_id: "guest-live" })).toBeNull();
  });

  it("only offers another request for declined or withdrawn seats", () => {
    for (const status of ["declined", "left"] as const) {
      const previous = { ...seat, status };
      expect(liveCoStreamAction(room, "viewer", previous))
        .toEqual({ kind: "ask", roomId: "room", seat: previous });
      expect(liveCoStreamAction(closed, "viewer", previous)).toBeNull();
    }
    expect(liveCoStreamAction(room, "viewer", { ...seat, status: "removed" })).toBeNull();
  });
});
