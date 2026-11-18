import { createContext } from "react";

/**
 * How far below the top of the screen the iPhone modal sheet this composer
 * sits in starts (0 everywhere else). Set by the screen boundary for screens
 * shown as a native sheet (live viewer, video player, sign-in).
 *
 * measureInWindow inside a native sheet counts from the sheet's top, while
 * the keyboard reports where its keys start counting from the screen's top.
 * Comparing the two left every composer in a sheet short by the sheet's top
 * (about 55pt): the live chat box ended up right under the keys, out of
 * sight while typing.
 */
export const SheetTopContext = createContext(0);
