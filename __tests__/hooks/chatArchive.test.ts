import { isPrefArchived } from '../../hooks/useChatPrefs';
import type { ChatPref } from '../../services/dm/dm.api';

jest.mock('../../services/dm/dm.api', () => ({}));
jest.mock('../../libs/toast', () => ({}));
jest.mock('../../i18n/copy', () => ({}));
jest.mock('../../libs/dm-e2ee/encrypt-choice', () => ({}));

const archived: ChatPref = {
  conversationId: 'room', archivedAt: '2026-01-02T12:00:00Z', mutedUntil: null,
  pinnedAt: null, markedUnread: false,
};

it('keeps a room archived until restored and a DM archived until a newer message arrives', () => {
  expect(isPrefArchived(undefined)).toBe(false);
  expect(isPrefArchived(archived)).toBe(true);
  expect(isPrefArchived(archived, archived.archivedAt)).toBe(true);
  expect(isPrefArchived(archived, '2026-01-03T12:00:00Z')).toBe(false);
  expect(isPrefArchived({ ...archived, archivedAt: null })).toBe(false);
});

it('keeps a muted archived DM in the archive while new messages arrive', () => {
  expect(isPrefArchived({ ...archived, mutedUntil: '2999-01-01' }, '2026-01-03T12:00:00Z')).toBe(true);
});
