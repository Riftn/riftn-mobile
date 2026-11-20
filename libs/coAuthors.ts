/**
 * Co-authored posts: who is on which post, the viewer's open invite, and the
 * one sheet that manages them. Feed rows carry `coAuthorUsers`; anything we
 * change here (an invite answered, someone removed) overrides that row until
 * the next fetch brings the same answer back.
 */
import { useSyncExternalStore } from "react";

export interface CoAuthorUser {
  address: string;
  username?: string;
  displayName?: string;
  avatarImageUrl?: string;
}

export interface CoAuthorState {
  users: CoAuthorUser[];
  invited?: boolean;
  pending?: CoAuthorUser[];
}

const EMPTY: CoAuthorUser[] = [];
const posts = new Map<string, CoAuthorState>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function cleanCoAuthors(value: unknown): CoAuthorUser[] {
  if (!Array.isArray(value)) return EMPTY;
  return value
    .filter((u: any) => u && typeof u.address === "string")
    .map((u: any) => ({ address: u.address.toLowerCase(), username: u.username, displayName: u.displayName, avatarImageUrl: u.avatarImageUrl }));
}

export function setCoAuthorState(tokenId: string | number, next: CoAuthorState) {
  posts.set(String(tokenId), next);
  emit();
}

/**
 * What the post shows: our own last answer if we have one, else the post
 * row's (`coAuthorUsers`, and `coAuthorInvited` on the post page payload).
 */
export function useCoAuthorState(tokenId: string | number | null | undefined, post?: any): CoAuthorState {
  useSyncExternalStore(subscribe, () => version, () => version);
  const known = tokenId != null ? posts.get(String(tokenId)) : undefined;
  if (known) return known;
  const users = cleanCoAuthors(post?.coAuthorUsers);
  return { users, invited: post?.coAuthorInvited === true };
}

export function coAuthorName(user: CoAuthorUser): string {
  return user.displayName || user.username || `${user.address.slice(0, 6)}…${user.address.slice(-4)}`;
}

/** The sheet, opened from a post's menu or its invite card; hosted once in App. */
let sheetTokenId: string | null = null;
let sheetTick = 0;
const sheetListeners = new Set<() => void>();
export function openCoAuthorSheet(tokenId: string | number) {
  sheetTokenId = String(tokenId);
  sheetTick++;
  sheetListeners.forEach(l => l());
}
export function closeCoAuthorSheet() {
  sheetTokenId = null;
  sheetTick++;
  sheetListeners.forEach(l => l());
}
export function useCoAuthorSheetRequest(): string | null {
  useSyncExternalStore(
    l => { sheetListeners.add(l); return () => { sheetListeners.delete(l); }; },
    () => sheetTick,
    () => sheetTick,
  );
  return sheetTokenId;
}
