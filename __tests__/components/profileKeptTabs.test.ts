import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

const visitor = read("components/UserProfile/UserProfileBottomContentTabs.tsx");
const own = read("components/Profile/ProfileTabs.tsx");
const collapse = read("components/Profile/useProfileCollapse.ts");
const tabBar = read("components/Profile/ProfileTabBar.tsx");
const pane = read("components/Profile/profilePaneScroll.tsx");
const rnPatch = read("patches/react-native+0.83.10.patch");

describe("profile tabs switch without rebuilding", () => {
  it("keeps opened tabs mounted in a hidden Activity on both profiles", () => {
    expect(pane).toContain('mode={active ? "visible" : "hidden"}');
    for (const source of [visitor, own]) {
      expect(source).toContain("<ProfilePane");
      expect(source).toContain("MAX_KEPT_TABS");
      expect(source).toContain("tabOffsets");
    }
  });

  it("keeps a hidden tab's native views so its lists keep their spot", () => {
    expect(pane).toContain('nativeID="keep-mounted"');
    expect(rnPatch).toContain('"keep-mounted" === hiddenProps.nativeID');
  });

  it("gives each kept tab its own list ref", () => {
    expect(visitor).toContain("listRefFor(tab)");
    expect(visitor).not.toMatch(/listRef=\{listRef\}/);
  });

  it("ignores the zero measurements of hidden header copies", () => {
    expect(collapse).toContain("if (bottom > 0) identityBottom.value = bottom");
    expect(collapse).toContain("if (bottom > 0) actionsBottom.value = bottom");
    expect(visitor).toMatch(/if \(height > 0\) \{\s*headerHeightShared\.value = height;/);
    expect(own).toMatch(/if \(height > 0\) \{ headerHeight\.value = height;/);
  });

  it("keeps the images grid when coming back to the same query", () => {
    expect(visitor).toContain("imagesQueryRef.current === query");
  });
});

describe("profile tab switch keeps the header still", () => {
  const { profileTabTarget } = require("../../components/Profile/profileTabTarget");
  it("opens the new tab at the same height while the header is in view", () => {
    expect(profileTabTarget(180, 900, 500)).toBe(180);
    expect(profileTabTarget(0, 700, 500)).toBe(0);
  });
  it("keeps the bar pinned once it is pinned, at the tab's own spot when lower", () => {
    expect(profileTabTarget(1400, undefined, 500)).toBe(500);
    expect(profileTabTarget(1400, 200, 500)).toBe(500);
    expect(profileTabTarget(1400, 2600, 500)).toBe(2600);
  });
  it("places every tab's lists through the pane context on both profiles", () => {
    for (const source of [visitor, own]) {
      expect(source).toContain("scroll={");
      expect(source).toContain("profileTabTarget(");
    }
  });
});

describe("pinned profile tab rail", () => {
  // A software-layer mask invalidated itself on every draw and kept the app
  // redrawing at full rate while the profile sat still.
  it("does not render its edge mask in software", () => {
    expect(tabBar).not.toContain('androidRenderingMode="software"');
  });
});
