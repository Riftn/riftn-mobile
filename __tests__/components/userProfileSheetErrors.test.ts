import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

const sheet = read("components/UserProfile/UserProfilePageContent.tsx");
const content = read("components/UserProfile/UserProfileSheetContent.tsx");
const tabs = read("components/UserProfile/UserProfileBottomContentTabs.tsx");
const grid = read("components/Profile/ProfileImageGrid.tsx");
const posts = read("components/Profile/PostsRoute.tsx");

describe("profile sheet error state", () => {
  it("shows an error state before falling back to the skeleton", () => {
    const errorBranch = content.indexOf("if (!data && error)");
    const skeletonBranch = content.indexOf("if (loading || !data)");
    expect(errorBranch).toBeGreaterThan(-1);
    expect(errorBranch).toBeLessThan(skeletonBranch);
    expect(content).toContain('t("profile.notFound")');
    expect(content).toContain('t("profile.doesNotExist")');
    expect(content).toContain('t("profile.unableToLoad")');
    expect(content).toContain("failed && onRetry");
  });

  it("wires error and retry into both the embedded and the modal profile", () => {
    expect(sheet.match(/error=\{error\}/g)).toHaveLength(2);
    expect(sheet.match(/onRetry=\{retry\}/g)).toHaveLength(2);
  });
});

describe("profile sheet follow list", () => {
  // navigate() from a follow list reuses that screen with its old tab and
  // overwrites it in the back stack; push gives each list its own route.
  it("pushes a new follow list from a stat tap", () => {
    expect(sheet).toContain("StackActions.push(ScreenNames.FollowList");
    expect(sheet).not.toMatch(/navigate\(ScreenNames\.FollowList/);
  });
});

describe("profile sheet clears the nav pill", () => {
  it("has no floating back-to-top button to collide with the pinned Follow button", () => {
    expect(tabs).not.toContain("profile.backToTop");
    expect(tabs).not.toContain("backToTopBottom");
    expect(content).not.toContain("backToTopBottom");
    expect(sheet).not.toContain("backToTopBottom");
  });

  it("pads the end of the image list and both grid layouts past the pill", () => {
    expect(grid.match(/paddingBottom: TAB_BAR_CONTENT_INSET/g)).toHaveLength(3);
  });
});

describe("profile posts tab load failure", () => {
  it("shows a retry instead of the empty state when the load failed", () => {
    const failedBranch = posts.indexOf("if (loadFailed && merged.length === 0)");
    const emptyBranch = posts.indexOf("if (merged.length === 0)");
    expect(failedBranch).toBeGreaterThan(-1);
    expect(failedBranch).toBeLessThan(emptyBranch);
    expect(posts).toContain('t("common.failedToLoad")');
    expect(posts).toContain("onPress={() => loadAll()}");
    expect(posts.match(/setLoadFailed\(true\)/g)).toHaveLength(2);
    expect(posts).toContain("setLoadFailed(false)");
  });
});
