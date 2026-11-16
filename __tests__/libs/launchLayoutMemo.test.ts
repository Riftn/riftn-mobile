const mockFiles: Record<string, string> = {};
jest.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class {
    name: string;
    constructor(_dir: string, name: string) { this.name = name; }
    get exists() { return this.name in mockFiles; }
    textSync() { return mockFiles[this.name]; }
    create() { mockFiles[this.name] = ""; }
    write(text: string) { mockFiles[this.name] = text; }
  },
}), { virtual: true });

import { __resetLayoutMemoForTests, recallLayout, recalledSize, rememberLayout } from "../../libs/launchLayoutMemo";

describe("launch layout memo", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    for (const key of Object.keys(mockFiles)) delete mockFiles[key];
    __resetLayoutMemoForTests();
  });
  afterEach(() => jest.useRealTimers());

  it("has nothing on a first run and falls back", () => {
    expect(recalledSize(recallLayout("home|system"), "headerHeight", 0)).toBe(0);
  });

  it("brings sizes back on the next launch", () => {
    rememberLayout("home|system", { headerHeight: 96, navOverlap: 38 });
    jest.advanceTimersByTime(3100);
    __resetLayoutMemoForTests();
    const sizes = recallLayout("home|system");
    expect(recalledSize(sizes, "headerHeight", 0)).toBe(96);
    expect(recalledSize(sizes, "navOverlap", 1)).toBe(38);
    expect(recalledSize(recallLayout("home|light"), "headerHeight", 0)).toBe(0);
  });

  it("ignores a damaged file and unusable numbers", () => {
    mockFiles["launch-layout-v1.json"] = "{not json";
    expect(recallLayout("home|system")).toEqual({});
    expect(recalledSize({ headerHeight: -4 }, "headerHeight", 7)).toBe(7);
    expect(recalledSize({ headerHeight: NaN }, "headerHeight", 7)).toBe(7);
  });
});
