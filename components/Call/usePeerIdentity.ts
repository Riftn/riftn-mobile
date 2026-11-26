import { useEffect, useState } from "react";
import { getAccountSummaries } from "../../services/user.service";

export interface PeerIdentity {
  name: string;
  avatarUrl: string | null;
}

function shorten(address: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
}

/**
 * Resolves the other side of a call to a username and avatar.
 *
 * The call screens used to carry a `// TODO: fetch username` and showed a
 * truncated wallet address for the whole call. `/account_info/batch` needs no
 * auth and takes one address happily, so there is no reason to answer a ringing
 * phone with `0x1234...abcd`. The shortened address stays as the fallback while
 * the request is in flight and if it fails.
 */
export function usePeerIdentity(peerAddress: string): PeerIdentity {
  const address = peerAddress.toLowerCase();
  const [identity, setIdentity] = useState<(PeerIdentity & { address: string }) | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!address) return;

    getAccountSummaries([address])
      .then((summaries) => {
        if (cancelled) return;
        const summary = summaries.find((account) => account.address.toLowerCase() === address);
        if (!summary) return;
        const name = summary.username
          ? `@${summary.username}`
          : summary.displayName || shorten(address);
        setIdentity({ address, name, avatarUrl: summary.avatarImageUrl === "default-avatar" ? null : summary.avatarImageUrl || null });
      })
      .catch(() => {
        /* the shortened address is a fine answer */
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return identity?.address === address ? identity : { name: shorten(peerAddress), avatarUrl: null };
}

export default usePeerIdentity;
