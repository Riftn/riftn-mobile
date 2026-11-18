import { useState } from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useMentions } from '../../hooks/useMentions';
import { mentionSearch } from '../../services/mention.service';

jest.mock('../../services/mention.service', () => ({
  mentionSearch: jest.fn(),
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
});
