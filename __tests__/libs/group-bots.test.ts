import { buyAlertExplorer, fmtPrice, parseBannedWords } from "../../libs/group-bots";
import { communityErrorMessage } from "../../libs/community-permissions";

describe("group bots", () => {
  it("parses banned words like web", () => {
    expect(parseBannedWords("Scam\nrug pull, SCAM ,, ")).toEqual(["scam", "rug pull"]);
  });

  it("reads per-token buy alerts and links the right explorer", () => {
    expect(buyAlertExplorer("bsc")).toBe("https://bscscan.com");
    expect(buyAlertExplorer(undefined)).toBe("https://basescan.org");
    expect(fmtPrice(0.00001234)).toBe("$0.00001234");
  });

  it("explains auto-mod refusals", () => {
    expect(communityErrorMessage({ message: "automod_flood:10" }, "x")).toMatch(/10s/);
    expect(communityErrorMessage({ message: "automod_links" }, "x")).toMatch(/Links/);
    expect(communityErrorMessage({ message: "automod_banned_word" }, "x")).toMatch(/word/);
  });
});
