/**
 * Arcade score cards: which links card as a game, and the share links that
 * name the sharer. Same rules as riftn-web src/lib/api/dehub/arcade-card.ts.
 */

/** Arcade games with a share card of their own (riftn.com/og/arcade-<slug>.jpg). */
export const ARCADE_CARD_SLUGS = new Set([
  'chestard', 'claude-of-duty', 'correspondence-chess', 'gods-eye', 'gratitude', 'jungle-trail',
  'kings-gambit', 'love-lock-bridge', 'okey', 'sillycoin', 'street-slayer', 'trenchstar',
]);

/** The game slug a `/arcade/<slug>` page path names, or null. */
export function arcadeSlugOf(pagePath: string): string | null {
  const m = /^\/(?:app\/)?arcade\/([a-z0-9-]{1,40})$/i.exec(pagePath);
  const slug = m?.[1]?.toLowerCase() ?? null;
  return slug && ARCADE_CARD_SLUGS.has(slug) ? slug : null;
}

export const arcadeArt = (slug: string) => `https://riftn.com/og/arcade-${slug}.jpg`;

/** The share link for a game, naming the sharer so the card can show their best. */
export function arcadeShareUrl(slug: string, username?: string | null): string {
  const base = `https://riftn.com/arcade/${slug}`;
  return username ? `${base}?by=${encodeURIComponent(username)}` : base;
}

/** `?by=` (who shared it) and `?snap=1` (posted with a snapshot picture) from a link's path. */
export function sharedLink(path: string): { by: string | null; snap: boolean } {
  const q = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
  const params: Record<string, string> = {};
  for (const part of q.split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) {
      try { params[k] = decodeURIComponent(v); } catch { params[k] = v; }
    }
  }
  const by = (params.by ?? '').trim().replace(/^@/, '');
  return { by: /^[A-Za-z0-9_.-]{1,42}$/.test(by) ? by : null, snap: params.snap === '1' };
}
