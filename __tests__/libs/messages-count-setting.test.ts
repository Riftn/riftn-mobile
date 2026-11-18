import { storage } from '../../libs/storage';
import {
  setShowMessagesCount, setShowNotificationCount, showMessagesCount, showNotificationCount,
} from '../../libs/notification-count-setting';

describe('Messages number setting', () => {
  beforeEach(() => storage.clearAll());

  it('is off by default', () => {
    expect(showMessagesCount()).toBe(false);
  });

  it('turns on and off', () => {
    setShowMessagesCount(true);
    expect(showMessagesCount()).toBe(true);
    setShowMessagesCount(false);
    expect(showMessagesCount()).toBe(false);
  });

  it('is its own switch, separate from the bell', () => {
    setShowNotificationCount(true);
    expect(showMessagesCount()).toBe(false);
    setShowMessagesCount(true);
    setShowNotificationCount(false);
    expect(showMessagesCount()).toBe(true);
    expect(showNotificationCount()).toBe(false);
  });
});
