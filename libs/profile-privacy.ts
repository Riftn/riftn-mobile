/**
 * Per-list profile privacy, kept in the public profile `customs` blob. Same
 * keys and values as web (src/hooks/use-privacy-settings.ts); the API enforces
 * the same rules, so these only decide what the app offers.
 */
export const FOLLOWERS_LIST_VISIBILITY_KEY = 'followersListVisibility';
export const FOLLOWING_LIST_VISIBILITY_KEY = 'followingListVisibility';
/** 'public' | 'private'. Absent means private: everyone's likes start hidden. */
export const LIKES_VISIBILITY_KEY = 'likesVisibility';

type Customs = Record<string, unknown> | null | undefined;

export function likesArePublic(customs: Customs): boolean {
  return customs?.[LIKES_VISIBILITY_KEY] === 'public';
}

/**
 * Which follow lists a visitor may open. The coarse `followVisibility`
 * ('counts-only' / 'hidden') and `hideFollowers` still hide both; on top of
 * that each list can be hidden on its own.
 */
export function parseFollowLists(customs: Customs, hideFollowers?: boolean): {
  showFollowersList: boolean;
  showFollowingList: boolean;
  showCounts: boolean;
} {
  const mode = customs?.followVisibility;
  const showCounts = mode !== 'hidden';
  const listsAllowed = (mode === undefined || mode === null || mode === 'public') && !hideFollowers;
  return {
    showFollowersList: listsAllowed && customs?.[FOLLOWERS_LIST_VISIBILITY_KEY] !== 'hidden',
    showFollowingList: listsAllowed && customs?.[FOLLOWING_LIST_VISIBILITY_KEY] !== 'hidden',
    showCounts,
  };
}

/**
 * The profile fields to save for a set of follow switches. Writes the old
 * `followVisibility` / `hideFollowers` too, so older app versions agree.
 * Hiding the numbers hides both lists.
 */
export function followListsUpdate(next: { followers: boolean; following: boolean; counts: boolean }): {
  hideFollowers: boolean;
  customs: Record<string, string>;
} {
  const followers = next.counts && next.followers;
  const following = next.counts && next.following;
  return {
    hideFollowers: !next.counts || (!followers && !following),
    customs: {
      [FOLLOWERS_LIST_VISIBILITY_KEY]: followers ? 'public' : 'hidden',
      [FOLLOWING_LIST_VISIBILITY_KEY]: following ? 'public' : 'hidden',
      followVisibility: !next.counts ? 'hidden' : followers || following ? 'public' : 'counts-only',
    },
  };
}
