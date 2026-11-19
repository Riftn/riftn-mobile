import { parseDehubLink } from './dehub-links';

/**
 * A Riftn page the app has its own screen for, as a dehub:// link, or null.
 *
 * iOS never hands an app its own universal link: opened from inside the app,
 * dehub.io/app/governance/<id> went to Safari instead of the proposal screen.
 * The custom scheme always comes back to the app, and the router opens any
 * /app page it has no screen for in the in-app browser, so nothing dead-ends.
 */
export function inAppDehubUrl(rawUrl: string): string | null {
  const match = parseDehubLink(rawUrl);
  if (match?.kind === 'proposal') return `dehub://app/governance/${match.proposalId}`;
  const own = rawUrl.match(/^(?:https?:\/\/)?(?:www\.)?(?:dehub\.io|riftn\.com)\/(app(?:[/?#].*)?)$/i);
  if (own) return `dehub://${own[1]}`;
  // A post's top-level share links (/newpost/3, /posts/1): the router has a
  // screen for both, so they open the post instead of the website.
  const post = rawUrl.match(/^(?:https?:\/\/)?(?:www\.)?(?:dehub\.io|riftn\.com)\/((?:newpost|posts)\/\d+(?:[/?#].*)?)$/i);
  return post ? `dehub://${post[1]}` : null;
}
