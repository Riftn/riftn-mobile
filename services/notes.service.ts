/**
 * Notes: a short line (60 characters) with an optional song, GIF or place,
 * shown in the row at the top of Messages for 24 hours. One per person; a new
 * one replaces the old. Same API as web's `lib/api/dehub/notes`.
 */
import { apiClient } from "../libs";
import type { StoryAuthor, StorySong } from "./stories.service";

export const NOTE_TEXT_MAX = 60;
export const NOTE_LOCATION_MAX = 40;

export interface Note {
  id: string;
  text: string | null;
  gifUrl: string | null;
  song: StorySong | null;
  location: string | null;
  postedAt: string;
  expiresAt: string;
}

export interface NoteEntry {
  author: StoryAuthor;
  note: Note;
}

export interface NoteInput {
  text?: string;
  gifUrl?: string;
  song?: StorySong;
  location?: string;
}

export function getNotes(): Promise<{ mine: NoteEntry | null; notes: NoteEntry[] }> {
  return apiClient.get("/notes", { isAuthRequired: true, quiet: true });
}

export function putNote(input: NoteInput): Promise<{ note: Note }> {
  return apiClient.post("/notes", input);
}

export function deleteNote(): Promise<{ ok: boolean }> {
  return apiClient.delete("/notes");
}

/** The GIF hosts a note accepts. */
export function isNoteGif(url: string): boolean {
  return /^https:\/\/([^/]+\.)?(giphy\.com|tenor\.com|googleusercontent\.com)\//i.test(url);
}
