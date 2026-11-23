jest.mock('../../services/user.service', () => ({ getNotifications: jest.fn() }));
jest.mock('../../libs/custom-notifications', () => ({ fetchCustomNotifications: jest.fn() }));

import { getNotifications } from '../../services/user.service';
import { fetchCustomNotifications } from '../../libs/custom-notifications';
import {
  __resetNotificationsCache,
  applyMarkedAllRead,
  markAllReadSettled,
  mergeFirstPage,
  noteMarkedAllRead,
  prefetchNotifications,
  readNotificationSnapshot,
  writeNotificationSnapshot,
} from '../../libs/notifications-cache';

const row = (id: string, createdAt: string) => ({ _id: id, createdAt } as any);

beforeEach(() => {
  __resetNotificationsCache();
  jest.clearAllMocks();
});

it('merges custom rows newest first and leaves the API page alone without them', () => {
  const api = [row('a', '2026-01-03'), row('b', '2026-01-01')];
  expect(mergeFirstPage(api, [])).toBe(api);
  expect(mergeFirstPage(api, [row('c', '2026-01-02')]).map((n) => n._id)).toEqual(['a', 'c', 'b']);
});

it('keeps the list per account, case-insensitively', () => {
  writeNotificationSnapshot('0xABC', [row('a', '2026-01-01')], []);
  expect(readNotificationSnapshot('0xabc')?.notifications[0]._id).toBe('a');
  expect(readNotificationSnapshot('0xdef')).toBeNull();
  expect(readNotificationSnapshot(null)).toBeNull();
});

it('shares one warm-up fetch between callers and stores what it got', async () => {
  (getNotifications as jest.Mock).mockResolvedValue({ result: [row('a', '2026-01-01')] });
  (fetchCustomNotifications as jest.Mock).mockResolvedValue([row('custom_x', '2026-01-02')]);
  const first = prefetchNotifications('0xabc');
  const second = prefetchNotifications('0xabc');
  expect(second).toBe(first);
  await first;
  expect(getNotifications).toHaveBeenCalledTimes(1);
  expect(readNotificationSnapshot('0xabc')?.notifications.map((n) => n._id)).toEqual(['custom_x', 'a']);
  // Fresh snapshot: a second warm-up right after is skipped.
  await prefetchNotifications('0xabc');
  expect(getNotifications).toHaveBeenCalledTimes(1);
});

describe('mark all as read', () => {
  const unread = (id: string, createdAt: string) => ({ _id: id, createdAt, read: false } as any);

  it('keeps every row up to the newest on screen read, even when a stale answer lands', () => {
    noteMarkedAllRead('0xabc', [unread('a', '2026-01-02'), unread('b', '2026-01-01')], null);
    const stale = [unread('new', '2026-01-03'), unread('a', '2026-01-02'), unread('b', '2026-01-01')];
    expect(applyMarkedAllRead('0xabc', stale).map((n) => n.read)).toEqual([false, true, true]);
    // Other accounts are untouched.
    expect(applyMarkedAllRead('0xdef', stale)).toBe(stale);
  });

  it('makes the warm-up wait for the writes before asking', async () => {
    let finish!: () => void;
    const writes = new Promise<void>((resolve) => { finish = resolve; });
    noteMarkedAllRead('0xabc', [unread('a', '2026-01-02')], writes);
    (getNotifications as jest.Mock).mockResolvedValue({ result: [unread('a', '2026-01-02')] });
    (fetchCustomNotifications as jest.Mock).mockResolvedValue([]);
    const warm = prefetchNotifications('0xabc', { force: true });
    await Promise.resolve();
    expect(getNotifications).not.toHaveBeenCalled();
    finish();
    const page = await warm;
    expect(getNotifications).toHaveBeenCalledTimes(1);
    expect(page?.api[0].read).toBe(true);
    expect(markAllReadSettled('0xabc')).toBeNull();
  });

  it('marks the saved list read so a reopen does not paint old counts', () => {
    writeNotificationSnapshot('0xabc', [unread('a', '2026-01-02')], [unread('a', '2026-01-02')]);
    noteMarkedAllRead('0xabc', [unread('a', '2026-01-02')], null);
    expect(readNotificationSnapshot('0xabc')?.countsSource[0].read).toBe(true);
  });
});
