import type { ShelfEntry, StoryItem } from '../../services/stories.service';
import { coverOf } from '../../components/Stories/story-utils';

jest.mock('../../libs/misc', () => ({ getAvatarUrl: jest.fn() }));
const photo = { type: 'photo', mediaUrl: 'photo.jpg', viewed: true } as StoryItem;
const video = { type: 'video', mediaUrl: 'video.mp4', posterUrl: 'opening.jpg', viewed: false } as StoryItem;
const shelf = (items: StoryItem[]) => ({ items } as ShelfEntry);

it('selects the still of the story the viewer will open, including on replay', () => {
  expect(coverOf(shelf([photo, video]))).toBe('opening.jpg');
  expect(coverOf(shelf([photo, { ...video, viewed: true }]))).toBe('photo.jpg');
  expect(coverOf(shelf([{ ...video, posterUrl: null }]))).toBeNull();
});
