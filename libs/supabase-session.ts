type KeyValueStore = { getItem: (key: string) => Promise<string | null> };

/**
 * The Supabase user the phone last held a session for, read straight from
 * storage.
 *
 * `supabase.auth.getSession()` answers the same question, but first refreshes
 * an expired access token over the network, and Supabase access tokens last an
 * hour. Boot asked it before lifting the splash, so most launches waited on a
 * token refresh to find out an id that was already on disk. A refresh never
 * changes who the user is, so the stored id is the same answer.
 */
export async function readStoredSessionUserId(
  storage: KeyValueStore,
  storageKey: string | undefined,
): Promise<string | null> {
  if (!storageKey) return null;
  try {
    const raw = await storage.getItem(storageKey);
    if (!raw) return null;
    const session = JSON.parse(raw);
    const id = session?.user?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** A refused restore is a resolved SDK response. Only commit a confirmed switch. */
export async function restoreSavedSession(
  pending: Promise<{ data: { session: { user: { id: string } } | null }; error: Error | null }>,
  expectedUserId: string | null,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { data, error } = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Supabase session restore timed out')), 10_000);
      }),
    ]);
    if (error) throw error;
    if (!data.session || (expectedUserId && data.session.user.id !== expectedUserId)) {
      throw new Error('Saved profile session was not restored');
    }
  } finally {
    clearTimeout(timer);
  }
}
