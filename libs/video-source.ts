import { Platform } from 'react-native';
import type { VideoPlayer, VideoSource } from 'expo-video';

const pending = new WeakMap<object, Promise<void>>();

function isRemote(source: VideoSource): boolean {
  const uri = typeof source === 'string' ? source : (source as { uri?: unknown } | null)?.uri;
  return typeof uri === 'string' && /^https?:\/\//i.test(uri);
}

/**
 * Source changes share a queue so a slow neighbour cannot overwrite a newer item.
 *
 * `immediate` (iPhone, a web address): hand the item to AVPlayer at once.
 * replaceAsync first loads the asset's duration and playability itself, on a
 * connection of its own: for an HLS ladder that is the master and a media
 * playlist fetched before the player holds anything, so a play() asked in
 * the meantime meets "no item to play" and the Short sits on its poster. On a
 * phone connection that wait was seconds per Short. With the item attached
 * straight away AVPlayer loads it itself and takes the play as soon as it can.
 */
export function replaceVideoSource(
  player: Pick<VideoPlayer, 'replaceAsync'> & Partial<Pick<VideoPlayer, 'replace'>>,
  source: VideoSource,
  options?: { immediate?: boolean },
): Promise<void> {
  const previous = pending.get(player);
  const now = !!options?.immediate && Platform.OS === 'ios' && isRemote(source) && typeof player.replace === 'function';
  // A released player (the viewer closed and reopened on a pooled cell) throws
  // synchronously; keep that a rejection so the caller's catch handles it
  // instead of it escaping an effect and crashing the screen.
  const replace = () => {
    if (now) {
      try {
        // true: no "use replaceAsync" warning; there is nothing to load here.
        (player as { replace: (source: VideoSource, disableWarning?: boolean) => void }).replace(source, true);
        return Promise.resolve();
      } catch {
        // Fall through to the usual way.
      }
    }
    try { return player.replaceAsync(source); } catch (error) { return Promise.reject(error); }
  };
  const next = previous ? previous.catch(() => {}).then(replace) : replace();
  pending.set(player, next);
  void next.finally(() => { if (pending.get(player) === next) pending.delete(player); }).catch(() => {});
  return next;
}
