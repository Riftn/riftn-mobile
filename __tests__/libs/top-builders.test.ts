import { fetchBuilderRows, periodStart, rankBuilders } from '../../libs/top-builders';

describe('fetchBuilderRows', () => {
  it('includes qualifying activity after the API row limit', async () => {
    const date = '2026-11-26T01:00:00Z';
    const comments = Array.from({ length: 1000 }, (_, index) => ({
      id: String(index).padStart(4, '0'), wallet_address: '0xa', feature_request_id: 'own', created_at: date,
    }));
    comments.push({ id: '1000', wallet_address: '0xA', feature_request_id: 'other', created_at: date });
    const cursors: (string | null)[] = [];
    const rows = await fetchBuilderRows(async (limit, afterId) => {
      cursors.push(afterId);
      return {
        data: comments.filter(row => afterId === null || row.id > afterId).slice(0, Math.min(limit, 1000)),
        error: null,
      };
    });
    const requests = [
      { id: 'own', author_wallet_address: '0xa', status: 'open', vote_count: 0, created_at: date, updated_at: date },
      { id: 'other', author_wallet_address: '0xb', status: 'open', vote_count: 0, created_at: date, updated_at: date },
    ];

    expect(cursors).toEqual([null, '0999']);
    expect(rows).toEqual(comments);
    expect(rankBuilders(requests, rows, 0, [])[0]).toMatchObject({ wallet: '0xa', comments: 1, points: 2 });
  });
});

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
