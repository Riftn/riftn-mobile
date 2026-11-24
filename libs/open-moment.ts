import i18n from 'i18next';
import { getStory } from '../services/stories.service';
import { openStoryViewer } from '../store/stories.store';
import { toastError } from './toast';

const MOMENT_ID = /^[a-f0-9]{24}$/i;

/**
 * Open one moment by id over whatever screen is showing (notification rows and
 * push taps for story likes and mentions). Says so when it has gone.
 */
export async function openMomentById(id: unknown, me?: string | null): Promise<boolean> {
  if (typeof id !== 'string' || !MOMENT_ID.test(id)) return false;
  try {
    const { author, item } = await getStory(id, !!me);
    if (!author || item.expired || item.status !== 'ready' || Date.parse(item.expiresAt) <= Date.now()) throw new Error('gone');
    openStoryViewer([{
      author,
      own: !!me && author.address.toLowerCase() === me.toLowerCase(),
      following: false,
      seen: item.viewed,
      latestAt: item.createdAt,
      items: [item],
    }], 0, true);
    return true;
  } catch {
    toastError(i18n.t('stories.originalUnavailable', { defaultValue: 'The original moment is no longer available.' }));
    return false;
  }
}
