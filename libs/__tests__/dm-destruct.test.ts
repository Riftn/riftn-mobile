import { countdownLabel, destructFromChoice, replaysLeft, withReplay } from "../dm-destruct";

describe("dm-destruct replay", () => {
  it("adds one replay only to the on-open timers", () => {
    expect(withReplay("open:10", true)).toBe("open:10:r1");
    expect(withReplay("open:10", false)).toBe("open:10");
    expect(withReplay("view", true)).toBe("view");
    expect(withReplay(60, true)).toBe(60);
    expect(withReplay(null, true)).toBeUndefined();
  });

  it("builds the optimistic copy with the replay", () => {
    expect(destructFromChoice("open:25:r1")).toEqual({ mode: "open", seconds: 25, replaysAllowed: 1, replaysUsed: 0 });
    expect(destructFromChoice("open:25")).toEqual({ mode: "open", seconds: 25 });
  });

  it("counts replays left and labels the countdown", () => {
    expect(replaysLeft({ mode: "open", replaysAllowed: 1, replaysUsed: 0 })).toBe(1);
    expect(replaysLeft({ mode: "open", replaysAllowed: 1, replaysUsed: 1 })).toBe(0);
    expect(replaysLeft({ mode: "open" })).toBe(0);
    expect(countdownLabel(28.2)).toBe("29s");
  });
});
