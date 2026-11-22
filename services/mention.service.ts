import { apiClient } from "../libs/api.client";
import i18n from "i18next";
import { supabase } from "./supabase";
import { filterNavRows } from "../libs/navSearch";
import { LINKABLE_PAGES } from "../libs/linkablePages";
import type { IconName } from "../components/ui/Icon";
import { IS_APP_STORE_BUILD } from "../config/storefront";

export interface MentionUser {
  username: string;
  displayName: string;
  avatarImageUrl: string;
  address: string;
  isFollowing: boolean;
  /**
   * Present only on the official AI account. The API also ranks it first among
   * its own matches, so tagging the bot is one tap rather than a scroll past
   * everyone who shares the prefix.
   */
  isAssistant?: boolean;
  /**
   * People (the default) type `@username`. A community or one of our pages
   * types its riftn.com link instead, which shows as a card once sent.
   */
  kind?: "user" | "community" | "page";
  /** Typed in place of `@username` when set. */
  insertText?: string;
  memberCount?: number;
  /** Page rows: the menu's icon for it. */
  icon?: IconName;
}

/** Links typed by the @ list always point at the live site. */
const LIVE_ORIGIN = "https://riftn.com";
const MAX_COMMUNITIES = 4;
const MAX_PAGES = 4;

/** Public communities and channels whose name or address matches. */
export async function communityMentionSearch(q: string): Promise<MentionUser[]> {
  if (!q) return [];
  const pattern = `"%${q.replace(/["\\]/g, "\\$&")}%"`;
  try {
    const { data, error } = await supabase
      .from("communities")
      .select("*")
      .eq("is_private", false)
      .or(`name.ilike.${pattern},slug.ilike.${pattern}`)
      .order("member_count", { ascending: false })
      .limit(MAX_COMMUNITIES + 4);
    if (error) throw error;
    return ((data ?? []) as any[])
      // Groups are private chats started from Messages, never something to link.
      .filter((c) => c.kind !== "group")
      .slice(0, MAX_COMMUNITIES)
      .map((c) => ({
        kind: "community" as const,
        username: c.slug,
        displayName: c.name,
        avatarImageUrl: c.avatar_url || "",
        address: `community:${c.id}`,
        isFollowing: false,
        memberCount: typeof c.member_count === "number" ? c.member_count : undefined,
        insertText: `${LIVE_ORIGIN}/app/communities/${encodeURIComponent(c.slug)}`,
      }));
  } catch (e) {
    console.warn("[communityMentionSearch] failed", e);
    return [];
  }
}

/** Our pages that match, through the same search as the menu sheet. */
export function pageMentionSearch(q: string): MentionUser[] {
  if (!q) return [];
  const t = (key: string, defaultValue: string) => i18n.t(key, { defaultValue }) as string;
  const pages = IS_APP_STORE_BUILD ? LINKABLE_PAGES.filter((p) => !p.storefrontHidden) : LINKABLE_PAGES;
  return filterNavRows(pages, q, t)
    .slice(0, MAX_PAGES)
    .map((page) => ({
      kind: "page" as const,
      username: page.path,
      displayName: t(page.labelKey, page.labelKey),
      avatarImageUrl: "",
      address: `page:${page.path}`,
      isFollowing: false,
      icon: page.icon,
      insertText: `${LIVE_ORIGIN}${page.path}`,
    }));
}

export async function mentionSearch(q: string): Promise<MentionUser[]> {
  if (!q || q.length < 1) return [];
  try {
    const res = await apiClient.get<{ result: MentionUser[] }>(
      `/users/mention_search?q=${encodeURIComponent(q)}`
    );
    return res?.result ?? [];
  } catch (e) {
    console.warn("[mentionSearch] failed", e);
    return [];
  }
}

/**
 * The signed-in person's own short list: people they tagged before, then
 * people they follow. Kept on the phone (libs/mentionPeople) so the first
 * letters after an @ are answered without a request. Throws on failure.
 */
export async function mentionSeed(): Promise<MentionUser[]> {
  const res = await apiClient.get<{ result: MentionUser[] }>("/users/mention_seed");
  return res?.result ?? [];
}
