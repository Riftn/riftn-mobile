import { useState } from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useMentions } from '../../hooks/useMentions';
import { mentionSearch } from '../../services/mention.service';

import { resetMentionPeople } from '../../libs/mentionPeople';

jest.mock('../../services/mention.service', () => ({
  mentionSearch: jest.fn(),
  mentionSeed: jest.fn(async () => []),
  communityMentionSearch: jest.fn(async () => []),
  pageMentionSearch: jest.fn(() => []),
}));

const search = mentionSearch as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const links = require('../../services/mention.service') as { communityMentionSearch: jest.Mock; pageMentionSearch: jest.Mock };

function setup() {
  return renderHook(() => {
    const [text, setText] = useState('');
    return { text, ...useMentions(text, setText) };
  });
}

type Hook = ReturnType<typeof setup>['result'];

/** Type or delete to `next`, with the caret at the end, then let the search land. */
async function edit(result: Hook, next: string) {
  await act(async () => {
    result.current.handleChangeText(next);
    jest.advanceTimersByTime(300);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('hooks/useMentions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetMentionPeople();
    search.mockReset();
    search.mockResolvedValue([{ username: 'alice' }]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens the list while a tag is typed', async () => {
    const { result } = setup();
    await edit(result, 'hi @a');
    expect(search).toHaveBeenCalledWith('a');
    expect(result.current.showSuggestions).toBe(true);
  });

  it('stays shut while an email address is typed', async () => {
    const { result } = setup();
    for (const next of ['name@', 'name@e', 'name@ex', 'name@example.com']) {
      await edit(result, next);
      expect(result.current.showSuggestions).toBe(false);
    }
    expect(search).not.toHaveBeenCalled();
  });

  it('shuts while deleting and comes back with the next character', async () => {
    const { result } = setup();
    await edit(result, 'hi @alic');
    expect(result.current.showSuggestions).toBe(true);
    search.mockClear();

    for (const next of ['hi @ali', 'hi @al', 'hi @a', 'hi @']) {
      await edit(result, next);
      expect(result.current.text).toBe(next);
      expect(result.current.showSuggestions).toBe(false);
    }
    expect(search).not.toHaveBeenCalled();

    await edit(result, 'hi @b');
    expect(search).toHaveBeenCalledWith('b');
    expect(result.current.showSuggestions).toBe(true);
  });

  it('drops a search that was still on its way when deleting started', async () => {
    const { result } = setup();
    act(() => {
      result.current.handleChangeText('hi @al');
    });
    await edit(result, 'hi @a');
    expect(search).not.toHaveBeenCalled();
    expect(result.current.showSuggestions).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('lists communities and pages after people, and types their link', async () => {
    links.communityMentionSearch.mockResolvedValueOnce([
      { kind: 'community', username: 'builders', displayName: 'Builders', avatarImageUrl: '', address: 'community:1', isFollowing: false, insertText: 'https://riftn.com/app/communities/builders' },
    ]);
    links.pageMentionSearch.mockReturnValueOnce([
      { kind: 'page', username: '/app/leaderboard', displayName: 'Leaderboard', avatarImageUrl: '', address: 'page:/app/leaderboard', isFollowing: false, insertText: 'https://riftn.com/app/leaderboard' },
    ]);
    const { result } = setup();
    await edit(result, 'see @b');
    expect(result.current.suggestions.map((u) => u.kind ?? 'user')).toEqual(['user', 'community', 'page']);
    act(() => {
      result.current.handleSelectionChange({ nativeEvent: { selection: { start: 6, end: 6 } } } as any);
      result.current.selectMention(result.current.suggestions[1]);
    });
    expect(result.current.text).toBe('see https://riftn.com/app/communities/builders ');
  });
  it('shows names it already knows at once, before the server answers', async () => {
    search.mockResolvedValue([
      { username: 'alice', displayName: 'Alice', address: '0xa1', avatarImageUrl: '', isFollowing: true },
      { username: 'albert', displayName: 'Albert', address: '0xa2', avatarImageUrl: '', isFollowing: false },
      { username: 'amy', displayName: 'Amy', address: '0xa3', avatarImageUrl: '', isFollowing: false },
    ]);
    const { result } = setup();
    await edit(result, 'hi @a');
    expect(result.current.suggestions.map((u) => u.username)).toEqual(['alice', 'albert', 'amy']);

    // The next letter: the answer to "a" is narrowed on the spot, with the
    // request for "al" not even sent yet.
    search.mockClear();
    search.mockResolvedValue([{ username: 'albert', displayName: 'Albert', address: '0xa2', avatarImageUrl: '', isFollowing: false }]);
    act(() => {
      result.current.handleChangeText('hi @al');
    });
    expect(search).not.toHaveBeenCalled();
    expect(result.current.showSuggestions).toBe(true);
    expect(result.current.suggestions.map((u) => u.username)).toEqual(['alice', 'albert']);

    // Then the server's own list takes over.
    await edit(result, 'hi @al');
    expect(search).toHaveBeenCalledWith('al');
    expect(result.current.suggestions.map((u) => u.username)).toEqual(['albert']);
    expect(result.current.loading).toBe(false);
  });

  it('does not ask again for letters it was just given an answer for', async () => {
    search.mockResolvedValue([{ username: 'alice', displayName: 'Alice', address: '0xa1', avatarImageUrl: '', isFollowing: false }]);
    const first = setup();
    await edit(first.result, '@ali');
    expect(search).toHaveBeenCalledTimes(1);

    // Another box, the same letters: the list is there with no request.
    const second = setup();
    act(() => {
      second.result.current.handleChangeText('@ali');
    });
    expect(second.result.current.suggestions.map((u) => u.username)).toEqual(['alice']);
    expect(second.result.current.loading).toBe(false);
    await edit(second.result, '@ali');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('offers a person who was picked before first', async () => {
    search.mockResolvedValue([
      { username: 'sam', displayName: 'Sam', address: '0xs1', avatarImageUrl: '', isFollowing: false },
      { username: 'sara', displayName: 'Sara', address: '0xs2', avatarImageUrl: '', isFollowing: false },
    ]);
    const { result } = setup();
    await edit(result, '@s');
    act(() => {
      result.current.handleSelectionChange({ nativeEvent: { selection: { start: 2, end: 2 } } } as any);
      result.current.selectMention(result.current.suggestions[1]);
    });
    expect(result.current.text).toBe('@sara ');

    search.mockResolvedValue([]);
    act(() => {
      result.current.handleChangeText('@sara @sa');
    });
    expect(result.current.suggestions.map((u) => u.username)).toEqual(['sara', 'sam']);
  });
});
