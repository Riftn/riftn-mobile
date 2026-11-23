/**
 * The menu drawer's default groups. Same groups and order as riftn-web
 * src/components/app/navigation/menu-groups.ts, keyed here by the drawer's
 * label keys. A row no group names still shows, at the end of the last group,
 * so a new page can never fall out of the menu (__tests__/libs/menuGroups.test.ts).
 */
export type MenuGroupId = "main" | "create" | "discover" | "money" | "riftn";

export interface MenuGroupDef {
  id: MenuGroupId;
  labelKey: string;
  fallback: string;
  keys: readonly string[];
}

export const MENU_GROUPS: readonly MenuGroupDef[] = [
  { id: "main", labelKey: "nav.groups.main", fallback: "Main", keys: ["nav.profile", "nav.explore", "nav.notifications", "nav.messages", "nav.communities", "nav.bookmarks", "nav.assistant", "nav.wallet", "nav.settings"] },
  { id: "create", labelKey: "nav.groups.create", fallback: "Create", keys: ["commandCentre.creator", "creator.editor", "nav.stages", "nav.tv", "nav.prompt", "nav.command", "nav.converter", "nav.migrate", "creatorPacks.title"] },
  { id: "discover", labelKey: "nav.groups.discover", fallback: "Discover", keys: ["nav.events", "nav.arcade", "miniApps.store.title", "nav.leaderboard", "nav.stats", "nav.agents", "nav.creators"] },
  { id: "money", labelKey: "nav.groups.money", fallback: "Money", keys: ["nav.staking", "nav.superpowers", "nav.fractions", "screens.usernames", "screens.accounts", "screens.work", "nav.affiliate", "nav.ads"] },
  { id: "riftn", labelKey: "nav.groups.riftn", fallback: "Riftn", keys: ["nav.featureRequests", "stats.feedback.title", "nav.governance", "nav.dao", "nav.careers", "nav.guide", "nav.glossary", "Compare Riftn", "nav.docs", "nav.blog", "nav.connectAi"] },
];

/** Never in a group (Home is a bottom tab; it only shows in the search). */
export const MENU_UNGROUPED = new Set(["nav.home"]);

export interface MenuGroup<T> extends MenuGroupDef {
  items: T[];
}

/** The group a row sits in by default, if any. */
export function defaultMenuGroupOf(labelKey: string): MenuGroupId | null {
  return MENU_GROUPS.find((def) => def.keys.includes(labelKey))?.id ?? null;
}

/**
 * Sort the visible rows into the groups, each in its default order; empty
 * groups drop. Rows the person moved to another group (libs/menuGroupMoves,
 * keyed by `idOf`) go to the end of that group instead.
 */
export function groupMenuItems<T extends { labelKey: string }>(
  items: readonly T[],
  moves: Readonly<Record<string, MenuGroupId>> = {},
  idOf: (labelKey: string) => string = (k) => k,
): MenuGroup<T>[] {
  const byKey = new Map(items.map((item) => [item.labelKey, item]));
  const movedTo = (key: string) => moves[idOf(key)];
  const placed = new Set<string>(MENU_UNGROUPED);
  const groups = MENU_GROUPS.map((def) => {
    const groupItems: T[] = [];
    for (const key of def.keys) {
      const item = byKey.get(key);
      if (!item) continue;
      const target = movedTo(key);
      if (target && target !== def.id) continue;
      groupItems.push(item); placed.add(key);
    }
    return { ...def, items: groupItems };
  });
  for (const item of items) {
    if (placed.has(item.labelKey)) continue;
    const target = movedTo(item.labelKey);
    const group = target ? groups.find((g) => g.id === target) : undefined;
    if (group) { group.items.push(item); placed.add(item.labelKey); }
  }
  const leftovers = items.filter((item) => !placed.has(item.labelKey));
  if (leftovers.length) groups[groups.length - 1].items.push(...leftovers);
  return groups.filter((group) => group.items.length > 0);
}
