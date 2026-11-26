import { periodStart, rankBuilders } from '../../libs/top-builders';

describe('rankBuilders', () => {
  it('keeps scores and history on their wallets when two handles swap', () => {
    const createdAt = '2026-11-03T00:00:00Z';
    const requests = [
      {
        id: '1', author_wallet_address: '0xa', author_username: 'old', author_avatar: 'old-avatar',
        status: 'shipped', vote_count: 6, created_at: createdAt, updated_at: createdAt,
      },
      {
        id: '2', author_wallet_address: '0xb', author_username: 'new', author_avatar: null,
        status: 'open', vote_count: 3, created_at: createdAt, updated_at: createdAt,
      },
    ];
    const comments = [
      { wallet_address: '0xA', username: 'old', feature_request_id: '2', created_at: createdAt },
      { wallet_address: '0xa', username: 'new', feature_request_id: '1', created_at: createdAt },
    ];
    const profiles = [
      { address: '0xB', username: 'old', avatarImageUrl: 'other-avatar' },
      { address: '0xA', username: 'new', avatarImageUrl: 'current-avatar' },
    ];

    for (const since of [0, periodStart('month', new Date('2026-11-26T12:00:00'))]) {
      const [original, other] = rankBuilders(requests, comments, since, profiles);
      expect(original).toMatchObject({
        wallet: '0xa', username: 'new', avatar: 'current-avatar', shipped: 1, votes: 6, comments: 1, points: 18,
      });
      expect(other).toMatchObject({ wallet: '0xb', username: 'old', avatar: 'other-avatar', points: 3 });
    }
    expect(rankBuilders(requests, comments, 0, [profiles[0]])[0]).toMatchObject({
      wallet: '0xa', username: null, avatar: null, points: 18,
    });
  });
});
