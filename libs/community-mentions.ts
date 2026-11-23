/**
 * Community Chat Mentions
 * =======================
 * Pulls the @handles and the @here broadcast out of a chat message so the
 * sender's client can ask the server to notify them.
 *
 * Parsing happens on the text rather than on what the mention dropdown
 * returned, because a handle typed straight into the box never touches the
 * dropdown and would otherwise notify nobody.
 */

/** Reserved handles that address a group rather than a person. */
const HERE_TOKENS = new Set(['here', 'channel', 'everyone']);

/**
 * A handle is letters, digits, underscore, dot or hyphen. A trailing dot or
 * hyphen is dropped so "ask @alice." and "@bob-" resolve to the handles rather
 * than to nothing.
 */
const MENTION_PATTERN = /(^|[^\w@/])@([a-z0-9_][a-z0-9_.-]{0,29})/gi;

export interface ParsedMentions {
  /** Lowercased, de-duplicated handles, in the order they appear. */
  usernames: string[];
  /** Whether the message addresses the whole chat. */
  here: boolean;
}

/** Positions use the original casing and leave sentence punctuation outside the link. */
export function* chatMentionSpans(content: string) {
  for (const match of content.matchAll(MENTION_PATTERN)) {
    const username = match[2].replace(/[.-]+$/, '');
    const start = match.index! + match[1].length;
    yield { start, end: start + username.length + 1, username, broadcast: HERE_TOKENS.has(username.toLowerCase()) };
  }
}

export function parseCommunityMentions(content: string | null | undefined): ParsedMentions {
  const usernames: string[] = [];
  const seen = new Set<string>();
  let here = false;

  for (const { username, broadcast } of chatMentionSpans(content ?? '')) {
    const handle = username.toLowerCase();
    if (broadcast) {
      here = true;
      continue;
    }

    if (!seen.has(handle)) {
      seen.add(handle);
      usernames.push(handle);
    }
  }

  return { usernames, here };
}

/** Whether a message needs a notification call at all. */
export function hasCommunityMentions(parsed: ParsedMentions): boolean {
  return parsed.here || parsed.usernames.length > 0;
}
