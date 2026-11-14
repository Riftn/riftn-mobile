import { clearOpenConversation, isConversationOpen, setOpenConversation } from '../../libs/activeChat';

test('tracks the chat on screen', () => {
  expect(isConversationOpen('a')).toBe(false);
  setOpenConversation('a');
  expect(isConversationOpen('a')).toBe(true);
  expect(isConversationOpen('b')).toBe(false);
  // A newer chat took over before the old one blurred: the old clear is a no-op.
  setOpenConversation('b');
  clearOpenConversation('a');
  expect(isConversationOpen('b')).toBe(true);
  clearOpenConversation('b');
  expect(isConversationOpen('b')).toBe(false);
  expect(isConversationOpen(undefined)).toBe(false);
});
