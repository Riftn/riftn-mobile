import {
  __resetLayoutMemoForTests, __saveLayoutMemoNowForTests, __useLayoutMemoFileForTests,
  recallLayout, recalledSize, rememberLayout,
} from "../../libs/launchLayoutMemo";

// A file held in memory and handed to the module directly: no module mock, no
// timers, nothing shared with other suites.
function memoryFile(initial?: string) {
  let text: string | undefined = initial;
  return {
    get exists() { return text !== undefined; },
    textSync: () => text ?? "",
    create: () => { text = ""; },
    write: (next: string) => { text = next; },
  };
}

describe("launch layout memo", () => {
  beforeEach(() => {
    __resetLayoutMemoForTests();
    __useLayoutMemoFileForTests(memoryFile());
  });
  afterEach(() => {
    __resetLayoutMemoForTests();
    __useLayoutMemoFileForTests(null);
  });

  it("has nothing on a first run and falls back", () => {
    expect(recalledSize(recallLayout("home|system"), "headerHeight", 0)).toBe(0);
  });

  it("brings sizes back on the next launch", () => {
    rememberLayout("home|system", { headerHeight: 96, navOverlap: 38 });
    __saveLayoutMemoNowForTests();
    __resetLayoutMemoForTests();
    const sizes = recallLayout("home|system");
    expect(recalledSize(sizes, "headerHeight", 0)).toBe(96);
    expect(recalledSize(sizes, "navOverlap", 1)).toBe(38);
    expect(recalledSize(recallLayout("home|light"), "headerHeight", 0)).toBe(0);
  });

  it("ignores a damaged file and unusable numbers", () => {
    __useLayoutMemoFileForTests(memoryFile("{not json"));
    expect(recallLayout("home|system")).toEqual({});
    expect(recalledSize({ headerHeight: -4 }, "headerHeight", 7)).toBe(7);
    expect(recalledSize({ headerHeight: NaN }, "headerHeight", 7)).toBe(7);
  });
});
