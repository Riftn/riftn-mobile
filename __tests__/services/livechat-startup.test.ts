jest.mock('../../libs/api.client', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('../../config/env', () => ({ __esModule: true, default: {} }));
jest.mock('../../libs/auth.utils', () => ({ getAuthToken: jest.fn() }));
jest.mock('../../i18n/copy', () => ({ translateCopy: jest.fn() }));

import { apiClient } from '../../libs/api.client';
import { loadInitialLiveChatMessages, preloadPublicLiveChatHistory } from '../../services/livechat.service';

const get = apiClient.get as jest.Mock;

beforeEach(() => {
  get.mockReset();
});

it('shares the inbox request with the opening public room', async () => {
  const history = { messages: [{ id: 'first' }] };
  get.mockResolvedValue(history);
  preloadPublicLiveChatHistory('viewer');
  await expect(loadInitialLiveChatMessages(undefined, 'viewer')).resolves.toEqual(history);
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith('/livechat/messages?limit=20');
});

it('bounds reuse to the viewer and the public room', async () => {
  const publicHistory = { messages: [{ id: 'public' }] };
  const fresh = { messages: [{ id: 'fresh' }] };
  get.mockResolvedValueOnce(publicHistory).mockResolvedValue(fresh);
  preloadPublicLiveChatHistory('first-viewer');
  await expect(loadInitialLiveChatMessages(undefined, 'second-viewer')).resolves.toEqual(fresh);
  await expect(loadInitialLiveChatMessages('stream-room', 'first-viewer')).resolves.toEqual(fresh);
  await expect(loadInitialLiveChatMessages(undefined, 'first-viewer')).resolves.toEqual(publicHistory);
  expect(get).toHaveBeenCalledTimes(3);
});

it('retries via the ordinary initial read if the tap request fails', async () => {
  const history = { messages: [{ id: 'recovered' }] };
  get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(history);
  preloadPublicLiveChatHistory('viewer');
  await expect(loadInitialLiveChatMessages(undefined, 'viewer')).resolves.toEqual(history);
  expect(get).toHaveBeenCalledTimes(2);
});
