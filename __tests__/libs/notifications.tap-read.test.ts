import { notificationsMatchingTap } from '../../libs/notifications.unread';

describe('notificationsMatchingTap', () => {
  const rows = [
    { _id: 'a', type: 'like', tokenId: 12, read: false },
    { _id: 'b', type: 'like', tokenId: 13, read: false },
    { _id: 'c', type: 'comment', tokenId: 12, commentId: 5, read: false },
    { _id: 'd', type: 'like', tokenId: 12, read: true },
  ];

  it('matches the unread row the push stands for', () => {
    expect(notificationsMatchingTap(rows, { type: 'like', tokenId: '12' }).map((r) => r._id)).toEqual(['a']);
  });

  it('needs every carried id to agree', () => {
    expect(notificationsMatchingTap(rows, { type: 'comment', tokenId: 12, commentId: 6 })).toEqual([]);
  });

  it('never clears rows for a push without ids', () => {
    expect(notificationsMatchingTap(rows, { type: 'like' })).toEqual([]);
  });
});
