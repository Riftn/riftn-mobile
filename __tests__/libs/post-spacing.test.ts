import { dripTimes, gapLabel, isLater } from "../../libs/post-spacing";

const t = (_k: string, o?: Record<string, unknown>) => String(o?.defaultValue ?? "").replace("{{n}}", String(o?.n ?? ""));

describe("post spacing", () => {
  it("names the gaps", () => {
    expect(gapLabel(30, t)).toBe("30 min");
    expect(gapLabel(60, t)).toBe("1 hour");
    expect(gapLabel(360, t)).toBe("6 hours");
    expect(gapLabel(1440, t)).toBe("1 day");
  });

  it("drips 20 photos one a day", () => {
    const now = new Date("2026-11-24T15:00:00Z");
    const times = dripTimes(new Date("2026-11-24T18:00:00Z"), 20, 1440, now);
    expect(times).toHaveLength(20);
    expect(times[19]).toEqual(new Date("2026-12-13T18:00:00Z"));
  });

  it("starts now when the start has passed", () => {
    const now = new Date("2026-11-24T15:00:00Z");
    const times = dripTimes(new Date("2026-11-24T10:00:00Z"), 2, 60, now);
    expect(isLater(times[0], now.getTime())).toBe(false);
    expect(times[1]).toEqual(new Date("2026-11-24T16:00:00Z"));
  });
});
