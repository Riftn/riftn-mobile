/**
 * How the menu drawer groups its pages: Tabs (one group at a time, the
 * default), Sections (every group under a header) or Folders (Main, then a
 * folder per group). Stored with the device prefs (hooks/useAppPrefs, web's
 * key `menu-layout`) and on the account as `menuLayout`, the key riftn-web
 * lib/menu-layout syncs, so the phone browser and the app agree.
 */
export type MenuLayout = "tabs" | "sections" | "folders";

export const MENU_LAYOUTS: readonly MenuLayout[] = ["tabs", "sections", "folders"];
export const DEFAULT_MENU_LAYOUT: MenuLayout = "tabs";
export const MENU_LAYOUT_PREF_KEY = "menuLayout";

export function isMenuLayout(value: unknown): value is MenuLayout {
  return value === "tabs" || value === "sections" || value === "folders";
}
