import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { storage } from '../../libs/storage';
import { __resetDraftCacheForTests } from '../../libs/draft-cache';
import { useAIConversation } from '../../hooks/useAIConversation';

jest.mock('../../context/AuthContext', () => ({ useUser: () => null }));
const mockFrom = jest.fn();
jest.mock('../../services/supabase', () => ({ supabase: { from: (name: string) => mockFrom(name) } }));
jest.mock('../../libs/supabase-wallet-client', () => ({ withWalletHeader: (query: unknown) => query }));
jest.mock('../../libs/assistantMedia', () => ({ materialise: jest.fn() }));
jest.mock('../../libs/storage-upload', () => ({ fileExtension: jest.fn(), uploadLocalFileToBucket: jest.fn() }));

beforeEach(async () => {
  await AsyncStorage.clear();
  storage.delete('dehub-drafts-v1');
  __resetDraftCacheForTests();
});

it('saves a delayed reply in its original thread after New Chat without replacing the new thread', async () => {
  const hook = renderHook(() => useAIConversation('anon'));
  const first = [{ role: 'user' as const, content: 'Original question' }];
  await act(async () => { await hook.result.current.saveMessage(first); });
  const originalId = hook.result.current.getConversationId();
  const finishOriginal = hook.result.current.saveMessage;
  act(() => hook.result.current.startNewConversation());
  const next = [{ role: 'user' as const, content: 'Different question' }];
  await act(async () => { await hook.result.current.saveMessage(next); });
  const nextId = hook.result.current.getConversationId();
  await act(async () => { await finishOriginal([...first, { role: 'assistant', content: 'Delayed answer' }]); });
  expect(nextId).not.toBe(originalId);
  expect(hook.result.current.getConversationId()).toBe(nextId);
  expect(hook.result.current.messages).toEqual(next);
  const original = JSON.parse((await AsyncStorage.getItem(`ai_assistant_conv_anon_${originalId}`))!);
  const current = JSON.parse((await AsyncStorage.getItem(`ai_assistant_conv_anon_${nextId}`))!);
  expect(original.messages.at(-1).content).toBe('Delayed answer');
  expect(current.messages).toEqual(next);
});

it('retries the same message ID and advances the watermark only after acknowledgment', async () => {
  const writes = jest.fn().mockResolvedValueOnce({ error: new Error('lost reply') }).mockResolvedValue({ error: null });
  mockFrom.mockImplementation((name: string) => name === 'ai_messages' ? { upsert: writes } : {
    upsert: jest.fn().mockResolvedValue({ error: null }),
    update: () => ({ eq: async () => ({ error: null }) }),
    select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }),
  });
  const hook = renderHook(() => useAIConversation('alice'));
  const first = { role: 'user' as const, content: 'Hello' };
  const second = { role: 'assistant' as const, content: 'Hi' };
  await act(async () => { await hook.result.current.saveMessage([first]); });
  await act(async () => { await hook.result.current.saveMessage([first, second]); });
  const rows = writes.mock.calls.map(([row]) => row);
  expect(rows.map(row => row.content)).toEqual(['Hello', 'Hello', 'Hi']);
  expect(rows[1].id).toBe(rows[0].id);
  expect(rows[2].id).not.toBe(rows[1].id);
});
