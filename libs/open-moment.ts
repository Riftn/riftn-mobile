import i18n from 'i18next';
import { getStory } from '../services/stories.service';
import { openStoryViewer } from '../store/stories.store';
import { toastError } from './toast';

const MOMENT_ID = /^[a-f0-9]{24}$/i;

/**
 * Open a moment from a notification. Its author can open an archived thread
 * through the same authenticated story endpoint used for a live thread.
 */
export async function openMomentById(id: unknown, me?: string | null, { openComments = false } = {}): Promise<boolean> {
  if (typeof id !== 'string' || !MOMENT_ID.test(id)) return false;
  try {
    const { author, item } = await getStory(id, !!me);
    if (!author || item.status !== 'ready') throw new Error('gone');
    const own = !!me && author.address.toLowerCase() === me.toLowerCase();
    const expired = item.expired || Date.parse(item.expiresAt) <= Date.now();
    if (expired && !(openComments && own)) throw new Error('gone');
    openStoryViewer([{
      author,
      own,
      following: false,
      seen: item.viewed,
      latestAt: item.createdAt,
      items: [item],
    }], 0, true, { openComments });
    return true;
  } catch {
    toastError(i18n.t('stories.originalUnavailable', { defaultValue: 'The original moment is no longer available.' }));
    return false;
  }
}
