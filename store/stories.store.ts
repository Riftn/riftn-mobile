/**
 * Moments state shared by the shelf, the viewer and the creator: which
 * moments are open, whether the creator is up, and the moment being shared in
 * the background (its tile on the shelf fills as it uploads).
 */
import { proxy, ref } from "valtio";
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
  viewer: { entries: ShelfEntry[]; index: number; standalone: boolean } | null;
  creator: { remixSource?: StoryRemixSource } | null;
  pending: PendingMoment | null;
}

export const storiesState = proxy<StoriesState>({ viewer: null, creator: null, pending: null });

export function openStoryViewer(entries: ShelfEntry[], index: number, standalone = false) {
  storiesState.viewer = ref({ entries, index, standalone });
}

export function closeStoryViewer() {
  storiesState.viewer = null;
}

export function openStoryCreator(remixSource?: StoryRemixSource) {
  storiesState.creator = { remixSource };
}

export function closeStoryCreator() {
  storiesState.creator = null;
}

export function setPendingMoment(next: PendingMoment | null | ((p: PendingMoment | null) => PendingMoment | null)) {
  const value = typeof next === "function" ? next(storiesState.pending ? { ...storiesState.pending } : null) : next;
  storiesState.pending = value ? { ...value, retry: value.retry ? ref(value.retry) as any : undefined } : null;
}
