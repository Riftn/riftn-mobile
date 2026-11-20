import { createContext, useContext } from 'react';

/**
 * How feed posts are split (Settings > Appearance > Layout), same choice and
 * storage key as web (lib/feed-separator):
 *
 * - bento: every post in its own rounded card (default).
 * - line:  no cards. One thin line between posts, as wide as the feed's top
 *          pill, and each post's content moves out to where the card's edge
 *          was. Media keeps its rounded corners and is never full width.
 *
 * Themes that already have no cards (Minimal, Immersive) keep their layout.
 */
export type FeedSeparator = 'bento' | 'line';

export function isFeedSeparator(value: unknown): value is FeedSeparator {
  return value === 'bento' || value === 'line';
}

/**
 * Room a line-mode post gains on each side: the card's 12pt inset (its 1pt
 * border is absorbed by the measured layouts that follow it).
 */
export const FEED_LINE_SIDE_GAIN = 12;

/** Set by a feed card drawn in line mode, so its media can size to the wider column. */
export const FeedLineContext = createContext(false);

export const useFeedLineMode = () => useContext(FeedLineContext);
