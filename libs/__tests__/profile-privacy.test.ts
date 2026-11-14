import { followListsUpdate, likesArePublic, parseFollowLists } from '../profile-privacy';

describe('profile privacy', () => {
  it('keeps likes private unless made public', () => {
    expect(likesArePublic(undefined)).toBe(false);
    expect(likesArePublic({})).toBe(false);
    expect(likesArePublic({ likesVisibility: 'public' })).toBe(true);
  });

  it('shows both follow lists by default', () => {
    expect(parseFollowLists({})).toEqual({ showFollowersList: true, showFollowingList: true, showCounts: true });
  });

  it('hides each list on its own', () => {
    expect(parseFollowLists({ followersListVisibility: 'hidden' }).showFollowersList).toBe(false);
    expect(parseFollowLists({ followersListVisibility: 'hidden' }).showFollowingList).toBe(true);
    expect(parseFollowLists({ followingListVisibility: 'hidden' }).showFollowingList).toBe(false);
  });

  it('keeps the old settings hiding both lists', () => {
    expect(parseFollowLists({ followVisibility: 'counts-only' })).toEqual({ showFollowersList: false, showFollowingList: false, showCounts: true });
    expect(parseFollowLists({}, true).showFollowersList).toBe(false);
  });

  it('writes old and new keys together', () => {
    expect(followListsUpdate({ followers: false, following: true, counts: true })).toEqual({
      hideFollowers: false,
      customs: { followersListVisibility: 'hidden', followingListVisibility: 'public', followVisibility: 'public' },
    });
    expect(followListsUpdate({ followers: true, following: true, counts: false })).toEqual({
      hideFollowers: true,
      customs: { followersListVisibility: 'hidden', followingListVisibility: 'hidden', followVisibility: 'hidden' },
    });
  });
});
