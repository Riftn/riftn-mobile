import { useState } from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useMentions } from '../../hooks/useMentions';
import { mentionSearch } from '../../services/mention.service';

jest.mock('../../services/mention.service', () => ({
  mentionSearch: jest.fn(),
}));

const search = mentionSearch as jest.Mock;

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
    await Promise.resolve();
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
});
