import { renderHook } from '@testing-library/react-native';
import { useFeatureCounts, useInProgressFeatures, useShippedFeatures } from '../../hooks/useFeatureRequests';

const mockUseQuery = jest.fn();
const mockFetch = jest.fn();
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => mockUseQuery(options) }));
jest.mock('../../services/supabase', () => {
  const { PostgrestClient } = require('@supabase/postgrest-js');
  return { supabase: new PostgrestClient('https://example.test', { fetch: (...args: unknown[]) => mockFetch(...args) }) };
});
jest.mock('../../libs/ai-consent', () => ({}));
jest.mock('../../context/AuthContext', () => ({}));
jest.mock('../../libs/supabase-wallet-client', () => ({}));
jest.mock('../../libs/toast', () => ({}));
jest.mock('../../libs/logger', () => ({ createLogger: () => ({}) }));
jest.mock('../../services/ai.service', () => ({}));
jest.mock('../../libs/deviceInfo', () => ({}));
jest.mock('../../context/ThemeContext', () => ({}));
jest.mock('../../i18n', () => ({}));
jest.mock('../../libs/storage-upload', () => ({}));

it('uses account-specific keys and limits the queued, shipped and count requests to that account', async () => {
  mockFetch.mockImplementation(async () => new Response('[]', { headers: { 'content-range': '*/0' } }));
  renderHook(() => {
    useInProgressFeatures('0xabc');
    useShippedFeatures('0xabc');
    useFeatureCounts('0xabc');
  });
  for (const [{ queryFn, queryKey }] of mockUseQuery.mock.calls) {
    expect(queryKey.at(-1)).toBe('0xabc');
    await queryFn();
  }
  const urls = mockFetch.mock.calls.map(([url]) => new URL(String(url)));
  expect(urls).toHaveLength(5);
  expect(urls.map(url => url.searchParams.get('status'))).toEqual([
    'in.(in_progress)', 'in.(completed,shipped)', null, 'not.in.("completed","shipped","declined","in_progress")',
    'not.in.("completed","shipped","declined","in_progress")',
  ]);
  // The last count is the open bug reports, for the Features / Bugs switch.
  expect(urls[4].searchParams.get('category')).toBe('in.(bug_fix,bug)');
  for (const url of urls) expect(url.searchParams.get('author_wallet_address')).toBe('ilike.0xabc');
});
