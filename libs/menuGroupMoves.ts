/**
 * Menu tiles moved to another group of the menu drawer (Main, Create,
 * Discover, Money, Riftn). Hold a tile and drop it on another tab to move it
 * there; dropping it back on its own tab undoes the move. The order inside a
 * group stays the dragged menu order (libs/navOrder).
 *
 * Saved on the device and in the account's preference blob under
 * `menuGroupMoves`, the same key and shape as riftn-web lib/menu-group-moves:
 * { [navOrderId]: groupId }.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { saveAccountPrefs } from "./feed-interests";
import type { MenuGroupId } from "./menuGroups";

export type MenuGroupMoves = Readonly<Record<string, MenuGroupId>>;

export const MENU_GROUP_MOVES_PREF_KEY = "menuGroupMoves";

const GROUP_IDS: readonly MenuGroupId[] = ["main", "create", "discover", "money", "riftn"];
const STORAGE_KEY = "dehub.menuGroupMoves";
const EMPTY: MenuGroupMoves = Object.freeze({});

export function isMenuGroupId(value: unknown): value is MenuGroupId {
  return typeof value === "string" && (GROUP_IDS as readonly string[]).includes(value);
}

export function sanitiseMenuGroupMoves(value: unknown): MenuGroupMoves {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
  const out: Record<string, MenuGroupId> = {};
  let n = 0;
  for (const [id, group] of Object.entries(value as Record<string, unknown>)) {
    if (!id || id.length > 80 || !isMenuGroupId(group)) continue;
    out[id] = group;
    if (++n >= 200) break;
  }
  return n ? out : EMPTY;
}

let state: MenuGroupMoves = EMPTY;
let loaded = false;
let touched = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function load() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw || touched) return;
      state = sanitiseMenuGroupMoves(JSON.parse(raw));
      emit();
    })
    .catch(() => { /* default groups */ });
}

function subscribe(fn: () => void) {
  load();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getMenuGroupMoves(): MenuGroupMoves {
  load();
  return state;
}

export function useMenuGroupMoves(): MenuGroupMoves {
  return useSyncExternalStore(subscribe, getMenuGroupMoves, () => EMPTY);
}

/** Device copy only; `saveMenuGroupMoves` also pushes to the account. */
export function writeMenuGroupMoves(moves: MenuGroupMoves) {
  touched = true;
  const clean = sanitiseMenuGroupMoves(moves);
  state = clean;
  emit();
  (Object.keys(clean).length
    ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
    : AsyncStorage.removeItem(STORAGE_KEY)
  ).catch(() => { /* best effort */ });
}

export function saveMenuGroupMoves(moves: MenuGroupMoves, wallet?: string | null) {
  writeMenuGroupMoves(moves);
  if (wallet) saveAccountPrefs(wallet, { [MENU_GROUP_MOVES_PREF_KEY]: getMenuGroupMoves() }).catch(() => { /* the device copy stands */ });
}

/**
 * Move one tile to `groupId`. Back to its own group clears the move. Returns
 * false when it is already there.
 */
export function moveMenuTile(id: string, groupId: MenuGroupId, homeGroup: MenuGroupId | null, wallet?: string | null): boolean {
  const moves: Record<string, MenuGroupId> = { ...getMenuGroupMoves() };
  const current = moves[id] ?? homeGroup;
  if (current === groupId) return false;
  if (homeGroup === groupId) delete moves[id];
  else moves[id] = groupId;
  saveMenuGroupMoves(moves, wallet);
  return true;
}
