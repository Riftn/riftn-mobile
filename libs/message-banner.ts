/**
 * The in-app banner for a new message, shown instead of the phone's own banner
 * while the app is open. The push handler hands the message over here; the
 * banner host (MessageBannerHost) draws it, and a pull down on it opens a
 * reply box. With no host mounted (signed out, still starting) nothing is
 * taken and the phone shows its normal banner.
 */
export interface MessageBanner {
  /** The push's own id, so the same push never shows twice. */
  id: string;
  conversationId: string;
  group: boolean;
  title: string;
  body: string;
  /** Address the push was sent to (several saved accounts). */
  recipient?: string;
}

type Listener = (banner: MessageBanner) => void;
let listener: Listener | null = null;

export function setMessageBannerListener(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** True when the banner was taken; false leaves the phone's banner to show. */
export function showMessageBanner(banner: MessageBanner): boolean {
  if (!listener) return false;
  try {
    listener(banner);
    return true;
  } catch {
    return false;
  }
}
