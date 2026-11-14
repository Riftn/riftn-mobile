import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("pages reopen with what they last showed", () => {
  const communities = readSource("screens/CommunitiesScreen.tsx");
  const leaderboard = readSource("screens/LeaderboardScreen.tsx");
  const service = readSource("services/leaderboard.service.ts");

  it("Communities starts from the kept list, for the same wallet only, and still refreshes", () => {
    expect(communities).toContain("lastShown && lastShown.wallet === wallet ? lastShown : null");
    expect(communities).toContain("useState(() => !shownFor(walletAddress))");
    expect(communities).toContain("lastShown = { wallet: walletAddress, discover, scores, mine };");
    const effect = communities.slice(communities.indexOf("const kept = shownFor(walletAddress);"));
    // The refresh is not skipped when there is a kept list.
    expect(effect.slice(0, effect.indexOf("}, [load, walletAddress]);"))).toMatch(/\}\s*load\(\);\s*$/);
  });

  it("Communities draws its rows after the first frame, with card shapes until then", () => {
    expect(communities).toContain("useDeferredValue(flatData, NO_ROWS)");
    expect(communities).toContain("data={rows}");
    expect(communities).toContain("loading || filling ?");
  });

  it("Leaderboard draws the default board the session already loaded", () => {
    expect(service).toContain("export function peekLeaderboard(sort: string, period: string)");
    expect(leaderboard).toContain('peekLeaderboard(DEFAULT_SORT_CATEGORY, "all")');
    expect(leaderboard).toContain("useState(!kept)");
    expect(leaderboard).toContain("useRef(!!kept)");
  });

  it("the offline cover is an overlay, so a canvas theme keeps it solid", () => {
    expect(readSource("screens/NoInternetScreen.tsx")).toContain('className="absolute inset-0 bg-theme-neutrals-900"');
  });
});
