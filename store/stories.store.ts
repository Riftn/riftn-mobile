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

interface StoriesState {
  viewer: { entries: ShelfEntry[]; index: number; standalone: boolean } | null;
  creatorOpen: boolean;
  pending: PendingMoment | null;
}

export const storiesState = proxy<StoriesState>({ viewer: null, creatorOpen: false, pending: null });

export function openStoryViewer(entries: ShelfEntry[], index: number, standalone = false) {
  storiesState.viewer = ref({ entries, index, standalone });
}

export function closeStoryViewer() {
  storiesState.viewer = null;
}

export function openStoryCreator() {
  storiesState.creatorOpen = true;
}

export function closeStoryCreator() {
  storiesState.creatorOpen = false;
}

export function setPendingMoment(next: PendingMoment | null | ((p: PendingMoment | null) => PendingMoment | null)) {
  const value = typeof next === "function" ? next(storiesState.pending ? { ...storiesState.pending } : null) : next;
  storiesState.pending = value ? { ...value, retry: value.retry ? ref(value.retry) as any : undefined } : null;
}
