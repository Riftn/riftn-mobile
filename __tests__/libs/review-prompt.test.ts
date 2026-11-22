jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn() }));
jest.mock('expo-application', () => ({ getInstallationTimeAsync: jest.fn() }));
jest.mock('expo-store-review', () => ({ hasAction: jest.fn(), requestReview: jest.fn() }));
jest.mock('../../libs/analytics', () => ({ track: jest.fn() }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as StoreReview from 'expo-store-review';
import { track } from '../../libs/analytics';
import { Linking } from 'react-native';
import { dismissReviewCard, noteNotificationMoment, notePostPublished, openStoreReviewPage, requestReviewAfter, shouldShowReviewCard } from '../../libs/review-prompt';

const DAY = 86400_000;
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => stored.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => { stored.set(key, value); });
  (Application.getInstallationTimeAsync as jest.Mock).mockResolvedValue(new Date(Date.now() - 10 * DAY));
  (StoreReview.hasAction as jest.Mock).mockResolvedValue(true);
  (StoreReview.requestReview as jest.Mock).mockResolvedValue(undefined);
});

it('asks once, then waits out the 90-day cooldown', async () => {
  expect(await requestReviewAfter('video_milestone')).toBe(true);
  expect(await requestReviewAfter('video_milestone')).toBe(false);
  expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  stored.set('dehub-review-prompted-at', String(Date.now() - 91 * DAY));
  expect(await requestReviewAfter('video_milestone')).toBe(true);
});

it('never asks in the first three days after install', async () => {
  (Application.getInstallationTimeAsync as jest.Mock).mockResolvedValue(new Date(Date.now() - 2 * DAY));
  expect(await requestReviewAfter('first_tip')).toBe(false);
  expect(StoreReview.requestReview).not.toHaveBeenCalled();
});

it('skips the prompt when the store cannot show one', async () => {
  (StoreReview.hasAction as jest.Mock).mockResolvedValue(false);
  expect(await requestReviewAfter('fifth_post')).toBe(false);
  expect(stored.has('dehub-review-prompted-at')).toBe(false);
});

it('tracks the first post and asks for a review on the fifth', async () => {
  for (let i = 0; i < 5; i++) await notePostPublished();
  expect(track).toHaveBeenCalledWith('first_post');
  expect(track).toHaveBeenCalledTimes(2);
  expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
});

it('only the first tip is a review moment', async () => {
  await noteNotificationMoment('tip');
  stored.delete('dehub-review-prompted-at');
  await noteNotificationMoment('tip');
  await noteNotificationMoment('like');
  expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
});

describe('Home review card', () => {
  const visitDays = async (start: number, days: number) => {
    let last = false;
    for (let i = 0; i < days; i++) last = await shouldShowReviewCard(start + i * DAY);
    return last;
  };

  it('waits for Home on four different days, counting a day once', async () => {
    const start = Date.now();
    expect(await shouldShowReviewCard(start)).toBe(false);
    expect(await shouldShowReviewCard(start + 1000)).toBe(false);
    expect(await visitDays(start + DAY, 2)).toBe(false);
    expect(await shouldShowReviewCard(start + 3 * DAY)).toBe(true);
  });

  it('Not now hides it for 30 days, the second time for good', async () => {
    const start = Date.now();
    expect(await visitDays(start, 4)).toBe(true);
    await dismissReviewCard(start + 3 * DAY);
    expect(await shouldShowReviewCard(start + 10 * DAY)).toBe(false);
    expect(await shouldShowReviewCard(start + 34 * DAY)).toBe(true);
    await dismissReviewCard(start + 34 * DAY);
    expect(await shouldShowReviewCard(start + 100 * DAY)).toBe(false);
  });

  it('Rate opens the store review page and retires the card', async () => {
    const start = Date.now();
    expect(await visitDays(start, 4)).toBe(true);
    await openStoreReviewPage(start + 3 * DAY);
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('id6770382811?action=write-review'));
    expect(await shouldShowReviewCard(start + 200 * DAY)).toBe(false);
  });

  it('stays away while the OS review sheet is cooling down', async () => {
    const start = Date.now();
    stored.set('dehub-review-prompted-at', String(start));
    expect(await visitDays(start, 4)).toBe(false);
  });
});
