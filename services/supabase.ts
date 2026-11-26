import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resilientAsyncStorage } from "../libs/storage-full";
import env from "../config/env";
// The token accessor directly, not services/ai.service's dehubAuthHeaders:
// that module imports nothing from here today, but a service importing a
// sibling service to reach a two-line helper is how import cycles start.
import { getAuthToken } from "../libs/auth.utils";
import { createWalletSessionFetch } from "../libs/wallet-session";
import { createSupabaseRelayFetch } from "../libs/supabaseRelayFetch";

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Never AsyncStorage directly: on Android it is a 6 MB SQLite file, and a
    // full one made every sign-in fail with SQLITE_FULL.
    storage: resilientAsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Signs wallet-scoped REST and storage requests; see libs/wallet-session.ts.
  // Underneath, falls back to the dehub.io relay when the project host is
  // unreachable; see libs/supabaseRelayFetch.ts.
  global: { fetch: createWalletSessionFetch(createSupabaseRelayFetch()) },
});

const walletClients = new Map<string, SupabaseClient>();

/**
 * A client pinned to one wallet, for the Storage API (web's walletScopedClient).
 *
 * `withWalletHeader` calls `setHeader` on a postgrest builder; the Storage
 * client has no such method, so a `storage.from(...).remove()` on the shared
 * client reaches the bucket policy with no wallet at all. Storage requests from
 * this client carry the wallet, so a bucket can check who is deleting.
 *
 * Not the shared client with a mutated header — that one serves every query in
 * the app and a global wallet header would change the RLS they all run under.
 * Same signing fetch, so it keeps working once bare headers stop being trusted.
 */
export function walletScopedClient(walletAddress: string): SupabaseClient {
  const wallet = walletAddress.toLowerCase();
  let client = walletClients.get(wallet);
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `dehub-wallet-client-${wallet}` },
      global: { headers: { "x-wallet-address": wallet }, fetch: createWalletSessionFetch() },
    });
    walletClients.set(wallet, client);
  }
  return client;
}

/**
 * Fetch an Agora RTC token from the Supabase edge function.
 * Reuses the same `agora-token` edge function as the web app.
 *
 * Open Stage guests request subscriber tokens without identity. Signed-in
 * listeners send their session so Agora can check approval for locked rooms.
 * Publishers still need an authorized room role.
 */
export async function fetchAgoraToken(
  channelName: string,
  role: "publisher" | "subscriber" = "publisher",
  uid: number = 0,
  walletAddress?: string | null,
): Promise<{ token: string; appId: string; uid: number }> {
  const headers: Record<string, string> = {};
  if (role === "publisher" || walletAddress) {
    const authToken = await getAuthToken();
    if (authToken) {
      headers["x-dehub-token"] = authToken;
      if (walletAddress) headers["x-wallet-address"] = walletAddress.toLowerCase();
    }
  }
  const { data, error } = await supabase.functions.invoke("agora-token", {
    body: { channelName, role, uid },
    ...(Object.keys(headers).length ? { headers } : {}),
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  if (!data?.appId || !data?.token) throw new Error("Agora credentials not configured");
  return { token: data.token, appId: data.appId, uid: data.uid ?? uid };
}
