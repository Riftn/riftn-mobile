jest.mock("../../services/dm/dm.api", () => ({ BUILTIN_CHAT_TABS: ["all", "direct", "communities", "requests"] }));
import { orderedTabs } from "../../libs/chat-tabs";

const name = (id: string) => id.toUpperCase();

describe("chat tab order", () => {
  it("starts with the built-in tabs", () => {
    expect(orderedTabs({ tabs: [], order: [], hidden: [] }, name).map((t) => t.id)).toEqual(["all", "direct", "communities", "requests"]);
  });

  it("follows the saved order, keeps every tab and never hides All", () => {
    const tabs = orderedTabs({
      tabs: [{ id: "t_work", name: "Work", emoji: "💼", chats: ["abc"] }],
      order: ["all", "t_work", "direct"],
      hidden: ["all", "requests"],
    }, name);
    expect(tabs.map((t) => t.id)).toEqual(["all", "t_work", "direct", "communities", "requests"]);
    expect(tabs.find((t) => t.id === "all")?.hidden).toBe(false);
    expect(tabs.find((t) => t.id === "requests")?.hidden).toBe(true);
  });
});
