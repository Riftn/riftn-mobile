import { hoursFromViewer, localTimeLine } from "../../hooks/useProfileLocalTime";

const copy = (_key: string, o: Record<string, unknown>) =>
  String(o.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k]));

describe("local time line", () => {
  it("is empty when they have not switched it on", () => {
    expect(localTimeLine(copy, "", undefined)).toBe("");
    expect(hoursFromViewer(undefined)).toBeNull();
    expect(hoursFromViewer("Not/AZone")).toBeNull();
  });

  it("measures the gap from the viewer, half hours kept", () => {
    const at = Date.UTC(2026, 0, 15, 12, 0);
    const mine = -new Date(at).getTimezoneOffset() / 60;
    expect(hoursFromViewer("Asia/Kolkata", at)).toBe(5.5 - mine);
    expect(hoursFromViewer("UTC", at)).toBe(-mine);
  });
});
