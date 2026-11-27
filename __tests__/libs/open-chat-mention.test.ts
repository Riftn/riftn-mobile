import { ScreenNames } from '../../navigation/ScreenNames';
import { clearPendingChatLink, peekPendingChatLink } from '../../libs/chatMessageLink';
import { openChatMention } from '../../libs/openChatMention';

afterEach(() => clearPendingChatLink());

it('opens the public room and queues the mentioned message', () => {
  const navigate = jest.fn();
  expect(openChatMention(navigate, { mentionContext: 'public_chat', roomId: 'topic-a', chatMessageId: 'm1' })).toBe(true);
  expect(navigate).toHaveBeenCalledWith(ScreenNames.LiveChat, { roomId: 'topic-a' });
  expect(peekPendingChatLink('public')).toMatchObject({ target: { roomId: 'topic-a' }, messageId: 'm1' });
});

it('honors legacy public chat push links and leaves post mentions alone', () => {
  const navigate = jest.fn();
  expect(openChatMention(navigate, { deepLink: '/chat?chatMessage=m2' })).toBe(true);
  expect(navigate).toHaveBeenCalledWith(ScreenNames.LiveChat, { roomId: 'global' });
  expect(peekPendingChatLink('public')?.messageId).toBe('m2');
  expect(openChatMention(navigate, { mentionContext: 'comment', tokenId: 42 })).toBe(false);
});
