/**
 * Moments state shared by the shelf, the viewer and the creator: which
 * moments are open, whether the creator is up, and the moment being shared in
 * the background (its tile on the shelf fills as it uploads).
 */
import { proxy, ref } from "valtio";
import { visualActivity } from "../libs/visualActivity";
import type { ShelfEntry } from "../services/stories.service";

export interface PendingMoment {
  key: string;
  preview: string;
  /** 0..1 */
  progress: number;
  state: "uploading" | "processing" | "failed";
  error?: string;
  retry?: () => void;
}

export interface StoryRemixSource {
  id: string;
  name: string;
}

interface StoriesState {
  viewer: { entries: ShelfEntry[]; index: number; standalone: boolean; openComments: boolean } | null;
  creator: { remixSource?: StoryRemixSource; postTokenId?: number } | null;
  pending: PendingMoment | null;
}

export const storiesState = proxy<StoriesState>({ viewer: null, creator: null, pending: null });

export function openStoryViewer(entries: ShelfEntry[], index: number, standalone = false, { openComments = false } = {}) {
  visualActivity.setStoryViewerOpen(true);
  storiesState.viewer = ref({ entries, index, standalone, openComments });
}

export function closeStoryViewer() {
  storiesState.viewer = null;
  visualActivity.setStoryViewerOpen(false);
}

export function openStoryCreator(remixSource?: StoryRemixSource) {
  storiesState.creator = { remixSource };
}

/** "Share to Moment": the creator opens on one of your own posts. */
export function openPostMoment(postTokenId: number) {
  closeStoryViewer();
  storiesState.creator = { postTokenId };
}

export function closeStoryCreator() {
  storiesState.creator = null;
}

export function setPendingMoment(next: PendingMoment | null | ((p: PendingMoment | null) => PendingMoment | null)) {
  const value = typeof next === "function" ? next(storiesState.pending ? { ...storiesState.pending } : null) : next;
  storiesState.pending = value ? { ...value, retry: value.retry ? ref(value.retry) as any : undefined } : null;
}
