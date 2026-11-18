import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  NativeSyntheticEvent,
  TextInputSelectionChangeEventData,
} from "react-native";
import {
  mentionSearch,
  communityMentionSearch,
  pageMentionSearch,
  type MentionUser,
} from "../services/mention.service";
import { caretFromEdit } from "../libs/caret-from-edit";

/**
 * Hook that adds @mention typeahead to any TextInput.
 *
 * Features:
 * - Detects `@query` at cursor → debounced API search
 * - Stays shut inside an email address and while deleting
 * - Also finds public communities and our pages, which insert their
 *   riftn.com link (a card once sent) instead of `@username `
 * - Inserts `@username ` on selection
 * - Backspacing into a filled mention deletes the whole `@username `
 */
export function useMentions(
  text: string,
  setText: (t: string) => void,
  /**
   * People to offer first, before anyone the search finds: in a group chat,
   * the people talking in it. With a pool, a bare "@" already opens the list.
   */
  pool?: MentionUser[],
  /** Also offer communities and pages. On unless a surface only wants people. */
  withLinks = true,
) {
  const poolRef = useRef<MentionUser[] | undefined>(pool);
  poolRef.current = pool;
  const [suggestions, setSuggestions] = useState<MentionUser[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectionRef = useRef({ start: 0, end: 0 });
  const prevTextRef = useRef(text);
  const trackedRef = useRef<Set<string>>(new Set());
  const queryRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keep ref synced with actual state (handles cases where setText is rejected).
  // In the same commit as the text, so a late run can never put an older text
  // back over the one just typed and make a backspace look like typing.
  useLayoutEffect(() => {
    prevTextRef.current = text;
  }, [text]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /** Walk backwards from cursor to find an `@query` at a word boundary. */
  const extractQuery = useCallback(
    (t: string, cursor: number): string | null => {
      let i = cursor - 1;
      while (i >= 0) {
        if (t[i] === "@") {
          // The @ has to start a word. One in the middle of a word is an
          // email address (name@example.com), not a tag.
          if (i === 0 || /\s/.test(t[i - 1])) {
            const q = t.slice(i + 1, cursor);
            return /^[\w.]*$/.test(q) ? q : null;
          }
          return null;
        }
        if (!/[\w.]/.test(t[i])) return null;
        i--;
      }
      return null;
    },
    [],
  );

  const handleChangeText = useCallback(
    (newText: string) => {
      const oldText = prevTextRef.current;

      // ── Whole‑mention deletion ──
      if (newText.length < oldText.length) {
        // Find where the deletion started by diffing
        let ds = 0;
        while (ds < newText.length && newText[ds] === oldText[ds]) ds++;

        for (const uname of [...trackedRef.current]) {
          const m = `@${uname}`;
          const mi = oldText.lastIndexOf(m, ds);
          if (mi >= 0 && ds >= mi && ds <= mi + m.length) {
            const trailing = oldText[mi + m.length] === " " ? 1 : 0;
            const result =
              oldText.slice(0, mi) + oldText.slice(mi + m.length + trailing);
            trackedRef.current.delete(uname);
            prevTextRef.current = result;
            setText(result);
            setShowSuggestions(false);
            setSuggestions([]);
            return;
          }
        }
      }

      prevTextRef.current = newText;
      setText(newText);

      // ── Deleting ──
      // Backspace never opens the list, and shuts it if it was open, so
      // nothing appears or jumps under the thumb mid-delete. It comes back
      // with the next character typed.
      if (newText.length < oldText.length) {
        queryRef.current = "";
        setShowSuggestions(false);
        setSuggestions([]);
        setLoading(false);
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }

      // ── Mention query detection ──
      const cursor = caretFromEdit(oldText, newText, selectionRef.current);
      const q = extractQuery(newText, cursor);

      const local = q != null ? poolMatches(poolRef.current, q) : [];
      if (q != null && (q.length >= 1 || local.length > 0)) {
        queryRef.current = q;
        setShowSuggestions(true);
        // The group's own people show at once; the search fills in after.
        setSuggestions(local);
        if (timerRef.current) clearTimeout(timerRef.current);
        if (q.length === 0) {
          setLoading(false);
          return;
        }
        setLoading(true);

        timerRef.current = setTimeout(async () => {
          if (queryRef.current !== q) return;
          try {
            // People first, then communities and our pages, which type their
            // riftn.com link instead of an @.
            const [res, communities] = await Promise.all([
              mentionSearch(q),
              withLinks ? communityMentionSearch(q) : Promise.resolve([] as MentionUser[]),
            ]);
            if (queryRef.current === q) {
              const seen = new Set(local.map((u) => u.username.toLowerCase()));
              const pages = withLinks ? pageMentionSearch(q) : [];
              const merged = [
                ...local,
                ...res.filter((u) => !seen.has(u.username.toLowerCase())),
                ...communities,
                ...pages,
              ];
              setSuggestions(merged);
              setShowSuggestions(merged.length > 0);
            }
          } finally {
            setLoading(false);
          }
        }, 250);
      } else {
        queryRef.current = "";
        setShowSuggestions(false);
        setSuggestions([]);
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    },
    [setText, extractQuery, withLinks],
  );

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = e.nativeEvent.selection;
    },
    [],
  );

  /** Replace the in‑progress `@query` with `@username `. */
  const selectMention = useCallback(
    (user: MentionUser) => {
      const cur = prevTextRef.current;
      const q = queryRef.current;
      const cursor = selectionRef.current.start;
      const start = cur.lastIndexOf(`@${q}`, cursor);
      if (start === -1) return;

      // A community or a page types its link; only people are tracked for
      // the whole-mention backspace.
      const replacement = `${user.insertText ?? `@${user.username}`} `;
      const result =
        cur.slice(0, start) + replacement + cur.slice(start + 1 + q.length);

      if (!user.insertText) trackedRef.current.add(user.username);
      prevTextRef.current = result;
      setText(result);
      setShowSuggestions(false);
      setSuggestions([]);
      queryRef.current = "";
    },
    [setText],
  );

  /** Call after sending / clearing the input. */
  const reset = useCallback(() => {
    trackedRef.current.clear();
    setShowSuggestions(false);
    setSuggestions([]);
    queryRef.current = "";
  }, []);

  return {
    handleChangeText,
    handleSelectionChange,
    suggestions,
    showSuggestions,
    selectMention,
    loading,
    reset,
  };
}

/** Pool entries whose username or name starts with the query (a word of it). */
function poolMatches(pool: MentionUser[] | undefined, q: string): MentionUser[] {
  if (!pool?.length) return [];
  const needle = q.toLowerCase();
  return pool
    .filter((u) => {
      if (!u.username) return false;
      if (!needle) return true;
      if (u.username.toLowerCase().startsWith(needle)) return true;
      return (u.displayName || "").toLowerCase().split(/\s+/).some((w) => w.startsWith(needle));
    })
    .slice(0, 8);
}
