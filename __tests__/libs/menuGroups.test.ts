import { MENU_GROUPS, MENU_UNGROUPED, groupMenuItems } from "../../libs/menuGroups";
import { isMenuLayout } from "../../libs/menuLayout";
import fs from "fs";
import path from "path";

// The drawer's resting rows, read from its NAV_ITEMS table.
const drawer = fs.readFileSync(path.join(__dirname, "../../components/Home/AppDrawer.tsx"), "utf8");
const table = drawer.slice(drawer.indexOf("const NAV_ITEMS: DrawerItem[] = ["), drawer.indexOf("];", drawer.indexOf("const NAV_ITEMS: DrawerItem[] = [")));
const restingKeys = table
  .split("\n")
  .filter((line) => line.includes("labelKey:") && !line.includes("searchOnly: true"))
  .map((line) => /labelKey: "([^"]+)"/.exec(line)?.[1])
  .filter((key): key is string => !!key);

describe("menu groups", () => {
  it("reads the drawer table", () => {
    expect(restingKeys.length).toBeGreaterThan(30);
  });

  it("gives every resting menu row a group", () => {
    const named = new Set(MENU_GROUPS.flatMap((group) => group.keys));
    expect(restingKeys.filter((key) => !named.has(key) && !MENU_UNGROUPED.has(key))).toEqual([]);
  });

  it("never names a row twice", () => {
    const keys = MENU_GROUPS.flatMap((group) => group.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps Main to one 3x3 screen and drops empty groups", () => {
    const groups = groupMenuItems(restingKeys.map((labelKey) => ({ labelKey })));
    expect(groups[0].id).toBe("main");
    expect(groups[0].items.length).toBeLessThanOrEqual(9);
    expect(groupMenuItems([{ labelKey: "nav.settings" }]).map((g) => g.id)).toEqual(["main"]);
  });

  it("puts a row no group names at the end of the last group", () => {
    const groups = groupMenuItems([{ labelKey: "nav.profile" }, { labelKey: "brand.new" }]);
    expect(groups[groups.length - 1].items.at(-1)?.labelKey).toBe("brand.new");
  });

  it("knows the three layouts", () => {
    expect(isMenuLayout("tabs")).toBe(true);
    expect(isMenuLayout("folders")).toBe(true);
    expect(isMenuLayout("grid")).toBe(false);
  });

  it("moves a row to the group it was dropped on, and only there", () => {
    const rows = MENU_GROUPS.flatMap((g) => g.keys).map((labelKey) => ({ labelKey }));
    const groups = groupMenuItems(rows, { "nav.wallet": "create" });
    expect(groups.find((g) => g.id === "main")!.items.map((i) => i.labelKey)).not.toContain("nav.wallet");
    expect(groups.find((g) => g.id === "create")!.items.map((i) => i.labelKey)).toContain("nav.wallet");
    expect(groups.flatMap((g) => g.items).filter((i) => i.labelKey === "nav.wallet")).toHaveLength(1);
  });
});

