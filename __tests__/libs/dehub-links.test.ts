import i18n from 'i18next';
import en from '../../i18n/locales/en.json';
import {
  parseDehubLink,
  findDehubLinks,
  findDehubLink,
  hasDehubLink,
  stripDehubLinks,
  stripDehubLinkMatches,
  dehubLinkLabel,
  previewLinks,
} from '../../libs/dehub-links';

describe('parseDehubLink', () => {
  it('reads the share link of a post that is not minted yet', () => {
    expect(parseDehubLink('https://riftn.com/newpost/4821?ref=AB12')).toMatchObject({
      kind: 'post',
      newPostId: '4821',
    });
    expect(parseDehubLink('https://riftn.com/newpost/abc')).toBeNull();
    expect(findDehubLink('look at this\nhttps://riftn.com/newpost/7')).toMatchObject({ kind: 'post', newPostId: '7' });
  });

  it('reads the short post link and its thread tail', () => {
    expect(parseDehubLink('https://riftn.com/posts/12')).toMatchObject({ kind: 'post', tokenId: '12' });
    expect(parseDehubLink('https://riftn.com/posts/12/b/55')).toMatchObject({ kind: 'post', tokenId: '12', commentId: '55' });
    expect(parseDehubLink('https://riftn.com/posts/12/x')).toBeNull();
  });

  it('reads a post link', () => {
    expect(parseDehubLink('https://dehub.io/app/post/12345')).toMatchObject({
      kind: 'post',
      tokenId: '12345',
      path: '/app/post/12345',
    });
  });

  it('treats /app/video/:id as a post', () => {
    expect(parseDehubLink('https://dehub.io/app/video/77')).toMatchObject({
      kind: 'post',
      tokenId: '77',
    });
  });

  it('keeps the query string on the path, so a link to a comment still lands on it', () => {
    const link = parseDehubLink('https://dehub.io/app/post/12345?comment=abc');
    expect(link?.path).toBe('/app/post/12345?comment=abc');
  });

  it('reads a post shared by its readable address', () => {
    expect(parseDehubLink('https://riftn.com/app/post/iron-man-7932')).toMatchObject({
      kind: 'post',
      articleSlug: 'iron-man-7932',
    });
    expect(parseDehubLink('https://riftn.com/app/post/iron-man-7932')?.tokenId).toBeUndefined();
  });

  it('rejects a post id that is neither a number nor a readable address', () => {
    expect(parseDehubLink('https://dehub.io/app/post/not_a_slug!')).toBeNull();
    expect(parseDehubLink('https://dehub.io/app/post/66c0a1b2c3d4e5f6a7b8c9d0')).toBeNull();
    expect(parseDehubLink('https://dehub.io/app/video/not-a-number')).toBeNull();
  });

  it('reads a community link with and without the /app prefix', () => {
    expect(parseDehubLink('https://dehub.io/app/communities/dehub')).toMatchObject({
      kind: 'community',
      slug: 'dehub',
    });
    // The marketing side of the site links here; the old regexes hard-coded /app
    // and so never carded these.
    expect(parseDehubLink('https://dehub.io/communities/dehub')).toMatchObject({
      kind: 'community',
      slug: 'dehub',
    });
  });

  it('reads an invite before the community slug swallows "join"', () => {
    expect(parseDehubLink('https://dehub.io/app/communities/join/AB12CD')).toMatchObject({
      kind: 'communityInvite',
      code: 'AB12CD',
    });
  });

  it('leaves an old store link as a plain link (Stores closed)', () => {
    expect(parseDehubLink('https://dehub.io/app/stores/0f4b1c2d-1111-2222-3333-444455556666')).toBeNull();
  });

  it('reads an event link', () => {
    expect(parseDehubLink('https://dehub.io/app/events/9')).toMatchObject({
      kind: 'event',
      eventNumber: '9',
    });
  });

  it('reads a stage link, which is top-level rather than /app-scoped', () => {
    expect(
      parseDehubLink('https://dehub.io/stage/6f1c2d84-9a3b-4c7e-8f01-2b5d9e7a4c33'),
    ).toMatchObject({
      kind: 'stage',
      stageId: '6f1c2d84-9a3b-4c7e-8f01-2b5d9e7a4c33',
    });
    // The bare path form has to work too — it is what the composer inserts
    // when the share origin matches the current host.
    expect(parseDehubLink('/stage/6f1c2d84-9a3b-4c7e-8f01-2b5d9e7a4c33')).toMatchObject({
      kind: 'stage',
      stageId: '6f1c2d84-9a3b-4c7e-8f01-2b5d9e7a4c33',
    });
  });

  it('rejects a stage id that is not id-shaped', () => {
    expect(parseDehubLink('https://dehub.io/stage/nope')).toBeNull();
  });

  it('reads the short stage form, which is what web now shares', () => {
    expect(parseDehubLink('https://dehub.io/stages/7')).toMatchObject({
      kind: 'stage',
      stageShortId: '7',
    });
    expect(parseDehubLink('/stages/7')).toMatchObject({
      kind: 'stage',
      stageShortId: '7',
    });
  });

  it('leaves the stages hub and its non-numeric children alone', () => {
    // Bare /stages is the list page, not a stage; anything else under it has
    // no route on either client.
    expect(parseDehubLink('https://dehub.io/stages')).toMatchObject({ kind: 'page', pagePath: '/stages' });
    expect(parseDehubLink('https://dehub.io/stages/upcoming')).toBeNull();
  });

  it('reads a film or series link, mapping the URL type onto the API one', () => {
    expect(parseDehubLink('https://dehub.io/cinema/film/12345')).toMatchObject({
      kind: 'film',
      filmId: '12345',
      filmObjectType: 'movie',
    });
    expect(parseDehubLink('https://dehub.io/cinema/series/678')).toMatchObject({
      kind: 'film',
      filmId: '678',
      filmObjectType: 'show',
    });
  });

  it('leaves the cinema search page and malformed titles alone', () => {
    expect(parseDehubLink('https://dehub.io/cinema')).toMatchObject({ kind: 'page', pagePath: '/cinema' });
    expect(parseDehubLink('https://dehub.io/cinema/film/abc')).toBeNull();
    expect(parseDehubLink('https://dehub.io/cinema/podcast/1')).toBeNull();
  });

  it('reads a profile link and strips a leading @', () => {
    expect(parseDehubLink('https://dehub.io/sableraven')).toMatchObject({
      kind: 'profile',
      username: 'sableraven',
    });
    expect(parseDehubLink('https://dehub.io/@sableraven')).toMatchObject({
      kind: 'profile',
      username: 'sableraven',
    });
  });

  it('reads a verified .eth handle as a profile', () => {
    // dehub.io/mal.eth is a real profile URL — accounts.ensName is an alias on
    // the account, and account_info answers for it exactly as for a username.
    expect(parseDehubLink('https://dehub.io/mal.eth')).toMatchObject({
      kind: 'profile',
      username: 'mal.eth',
    });
    expect(parseDehubLink('https://dehub.io/@mal.eth')).toMatchObject({
      kind: 'profile',
      username: 'mal.eth',
    });
    // ENS names may be non-ASCII, which the username charset cannot express.
    expect(parseDehubLink('https://dehub.io/%D9%85%D8%B1%D8%AD%D8%A8%D8%A7.eth')).toMatchObject({
      kind: 'profile',
      username: 'مرحبا.eth',
    });
  });

  it('does not card a file as a person', () => {
    // A username can never contain a dot, so anything dotted that is not a
    // .eth name is an asset path — these used to card as @favicon.ico.
    for (const asset of ['favicon.ico', 'og-image.png', 'dehub.apk', 'name.ethx']) {
      expect(parseDehubLink(`https://dehub.io/${asset}`)).toBeNull();
    }
  });

  it('does not mistake a route for a person', () => {
    // /:username is the catch-all on web, so every product page would otherwise
    // parse as a profile that resolves to nothing.
    // Our pages card as the page instead (kind 'page'), never as a person.
    for (const route of ['pricing', 'premium', 'explore', 'docs', 'app']) {
      expect(parseDehubLink(`https://dehub.io/${route}`)?.kind).toBe('page');
    }
    expect(parseDehubLink('https://dehub.io/settings')?.kind).not.toBe('profile');
  });

  it('refuses to card somebody else\'s host', () => {
    expect(parseDehubLink('https://evil.example/app/post/1')).toBeNull();
    expect(parseDehubLink('https://dehub.io.evil.example/app/post/1')).toBeNull();
  });

  it('accepts our other hosts and bare in-app paths', () => {
    expect(parseDehubLink('https://legacy.dehub.io/app/post/5')).toMatchObject({ kind: 'post' });
    expect(parseDehubLink('dehub.app/app/post/5')).toMatchObject({ kind: 'post' });
    expect(parseDehubLink('/app/post/5')).toMatchObject({ kind: 'post', tokenId: '5' });
  });

  it('does not read a bare path as a profile', () => {
    // "/foo" in a sentence is far more likely to be a path somebody typed.
    expect(parseDehubLink('/sableraven')).toBeNull();
  });

  it('drops the punctuation a sentence leaves on the end of a URL', () => {
    expect(parseDehubLink('https://dehub.io/app/post/12345.')).toMatchObject({ tokenId: '12345' });
    expect(parseDehubLink('https://dehub.io/app/post/12345),')).toMatchObject({ tokenId: '12345' });
  });

  it('ignores a fragment', () => {
    expect(parseDehubLink('https://dehub.io/app/post/12345#top')).toMatchObject({
      kind: 'post',
      path: '/app/post/12345',
    });
  });

  it('returns null for junk', () => {
    expect(parseDehubLink('')).toBeNull();
    expect(parseDehubLink('hello world')).toBeNull();
    expect(parseDehubLink('https://dehub.io')).toBeNull();
  });
});

describe('findDehubLinks', () => {
  it('finds every link in source order', () => {
    const text =
      'look at https://dehub.io/app/post/1 and then https://dehub.io/app/communities/dehub please';
    expect(findDehubLinks(text).map((l) => l.kind)).toEqual(['post', 'community']);
  });

  it('does not double-count a link the absolute pass already claimed', () => {
    const text = 'https://dehub.io/app/communities/dehub';
    expect(findDehubLinks(text)).toHaveLength(1);
  });

  it('finds a bare in-app path alongside a full URL', () => {
    const text = 'see /app/post/2 or https://dehub.io/app/events/3';
    expect(findDehubLinks(text).map((l) => l.kind).sort()).toEqual(['event', 'post']);
  });

  it('ignores links to other sites', () => {
    expect(findDehubLinks('https://example.com/app/post/1')).toEqual([]);
  });

  it('does not card a foreign URL through its path', () => {
    // A card claims the content is Riftn's. The bare-path pass used to match
    // the "/app/post/1" sitting inside an already-rejected foreign URL.
    expect(findDehubLinks('look at https://evil.example/app/post/1 now')).toEqual([]);
    expect(findDehubLinks('https://example.com/communities/dehub')).toEqual([]);
    expect(findDehubLinks('https://dehub.io.attacker.com/app/post/9')).toEqual([]);
    // Scheme-less, which is the case that pins the regex: ABSOLUTE_URL_RE makes
    // https?:// optional, so pass 1 still claims this span and rejects it on the
    // host check. Require the scheme and pass 2 reads the trailing /app/post/1
    // as a host-less path — which can only be ours — and cards it.
    expect(findDehubLinks('example.com/app/post/1')).toEqual([]);
  });

  it('still finds our own link when a foreign one sits beside it', () => {
    const found = findDehubLinks('https://example.com/app/post/1 and https://dehub.io/app/post/2');
    expect(found).toHaveLength(1);
    expect(found[0].tokenId).toBe('2');
  });

  it('handles empty input', () => {
    expect(findDehubLinks('')).toEqual([]);
    expect(findDehubLinks(null)).toEqual([]);
    expect(findDehubLinks(undefined)).toEqual([]);
  });

  it('finds a short stage link written as a bare path', () => {
    // The bare-path pass has to admit the plural: /stages/7 is the form web's
    // share sheet builds whenever the row has a short_id.
    const links = findDehubLinks('town hall tonight — /stages/7 see you there');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'stage', stageShortId: '7' });
  });

  it('findDehubLink returns the first, hasDehubLink the presence', () => {
    const text = 'https://dehub.io/app/post/1 https://dehub.io/app/events/2';
    expect(findDehubLink(text)?.kind).toBe('post');
    expect(hasDehubLink(text)).toBe(true);
    expect(hasDehubLink('nothing here')).toBe(false);
  });
});

describe('stripping', () => {
  it('removes the URL and tidies the whitespace it left behind', () => {
    expect(stripDehubLinks('check this out https://dehub.io/app/post/1')).toBe('check this out');
  });

  it('strips only the links it was given, so a capped surface keeps the rest as text', () => {
    const a = 'https://dehub.io/app/post/1';
    const b = 'https://dehub.io/app/post/2';
    const text = `${a} and ${b}`;
    const [first] = findDehubLinks(text);
    expect(stripDehubLinkMatches(text, [first])).toBe(`and ${b}`);
  });

  it('leaves text with no Riftn links alone', () => {
    expect(stripDehubLinks('just some words')).toBe('just some words');
  });

  it('survives empty input', () => {
    expect(stripDehubLinks('')).toBe('');
    expect(stripDehubLinkMatches(null, [])).toBe('');
  });
});

describe('dehubLinkLabel', () => {
  beforeAll(async () => {
    await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } } });
  });

  it('names every kind', () => {
    expect(dehubLinkLabel('post')).toBe('post');
    expect(dehubLinkLabel('communityInvite')).toBe('community invite');
    expect(dehubLinkLabel('bounty')).toBe('bounty');
  });
});

/**
 * /bounty and legacy /work links.
 *
 * Bounty detail pages moved from /work/<uuid> to /bounty/<job_number>, but old
 * links are still out in the wild and both shapes have to card. Bare /bounty
 * and the /work app pages (board, post, history) are not entities and must
 * stay plain links, the same way bare /stages does.
 */
describe('findDehubLinks /bounty and legacy /work', () => {
  it('cards the canonical bounty link', () => {
    const m = parseDehubLink('https://dehub.io/bounty/7');
    expect(m).not.toBeNull();
    expect(m!.kind).toBe('bounty');
    expect(m!.bountyJobKey).toBe('7');
  });

  it('cards a bare bounty path, which can only be ours', () => {
    const found = findDehubLinks('claim it: /bounty/7');
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('bounty');
    expect(found[0].bountyJobKey).toBe('7');
  });

  it('cards the legacy uuid detail link', () => {
    const m = parseDehubLink('https://dehub.io/work/3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(m).not.toBeNull();
    expect(m!.kind).toBe('bounty');
    expect(m!.bountyJobKey).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
  });

  it('keeps the path as written for a legacy edit link', () => {
    const m = parseDehubLink('https://dehub.io/work/3fa85f64-5717-4562-b3fc-2c963f66afa6/edit');
    expect(m).not.toBeNull();
    expect(m!.kind).toBe('bounty');
    expect(m!.path).toBe('/work/3fa85f64-5717-4562-b3fc-2c963f66afa6/edit');
  });

  it('does not card the board or its app pages as entities', () => {
    expect(parseDehubLink('https://dehub.io/work')?.kind).toBe('page');
    expect(parseDehubLink('https://dehub.io/work/post')).toBeNull();
    expect(parseDehubLink('https://dehub.io/work/history')?.kind).toBe('page');
    expect(parseDehubLink('https://dehub.io/work/disputes')).toBeNull();
  });

  it('does not read the bare board as a profile called "bounty"/"work"', () => {
    expect(parseDehubLink('https://dehub.io/bounty')).toBeNull();
    expect(parseDehubLink('https://dehub.io/work')?.kind).toBe('page');
  });

  it('rejects a non-numeric bounty id and a too-short work key', () => {
    expect(parseDehubLink('https://dehub.io/bounty/abc')).toBeNull();
    expect(parseDehubLink('https://dehub.io/work/123')).toBeNull();
  });

  it('does not card a foreign host through the bounty or work path', () => {
    expect(parseDehubLink('https://evil.example/bounty/7')).toBeNull();
    expect(parseDehubLink('https://evil.example/work/3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBeNull();
  });
});

/**
 * Three lists used to answer "is this single segment a username?" — the 94 in
 * reserved-usernames, 14 in linking.config and 48 here — and they drifted until
 * the deep-link one was missing 84 canonical names. Tapping dehub.io/docs or
 * /music opened a profile sheet for a user who does not exist.
 *
 * They are one list now. These fail if a second one reappears.
 */
describe('reserved segments are one list', () => {
  const { RESERVED_USERNAMES, RESERVED_LINK_SEGMENTS } = jest.requireActual(
    '../../libs/reserved-usernames',
  );

  it('protects every reserved username from being read as a profile link', () => {
    const unprotected = [...RESERVED_USERNAMES].filter(
      (name: string) => !RESERVED_LINK_SEGMENTS.has(name),
    );
    expect(unprotected).toEqual([]);
  });

  it('still protects the routing-only names that are not usernames', () => {
    for (const name of ['stream', 'feeds', 'welcome', 'auth-callback', 'bounty', 'dpay']) {
      expect(RESERVED_LINK_SEGMENTS.has(name)).toBe(true);
    }
  });

  it('covers the product paths that were opening empty profiles', () => {
    for (const name of [
      'docs', 'blog', 'shorts', 'music', 'tv', 'work', 'explore', 'pricing',
      'settings', 'wallet', 'messages', 'notifications', 'stores',
      'leaderboard', 'governance',
    ]) {
      expect(RESERVED_LINK_SEGMENTS.has(name)).toBe(true);
    }
  });

  it('leaves an ordinary name claimable', () => {
    expect(RESERVED_LINK_SEGMENTS.has('maldoteth')).toBe(false);
  });
});

describe('feature request and page links', () => {
  const id = '9cea24f0-1234-4abc-8def-0123456789ab';

  it('cards a Requests share link as that request', () => {
    expect(parseDehubLink(`https://riftn.com/features?feature=${id}`)).toMatchObject({ kind: 'featureRequest', featureRequestId: id });
    expect(parseDehubLink(`https://riftn.com/app/features?request=${id}`)).toMatchObject({ kind: 'featureRequest', featureRequestId: id });
  });

  it('cards our pages as pages', () => {
    expect(parseDehubLink('https://riftn.com/features')).toMatchObject({ kind: 'page', pagePath: '/features' });
    expect(parseDehubLink('https://riftn.com/app/leaderboard')).toMatchObject({ kind: 'page', pagePath: '/app/leaderboard' });
    expect(parseDehubLink('https://riftn.com/shorts')).toMatchObject({ kind: 'page', pagePath: '/shorts' });
    expect(parseDehubLink('https://riftn.com/arcade/kings-gambit')).toMatchObject({ kind: 'page', pagePath: '/arcade/kings-gambit' });
  });

  it('leaves unknown paths, bare paths and other hosts alone', () => {
    expect(parseDehubLink('https://riftn.com/app/not-a-page')).toBeNull();
    expect(parseDehubLink('/app/leaderboard')).toBeNull();
    expect(parseDehubLink('https://evil.example/app/leaderboard')).toBeNull();
  });
});

describe('previewLinks', () => {
  it('shows old dehub.io links as riftn.com', () => {
    expect(previewLinks('https://dehub.io/app/leaderboard')).toBe('https://riftn.com/app/leaderboard');
    expect(previewLinks('look https://www.dehub.io/app/x?y=1 ok')).toBe('look https://riftn.com/app/x?y=1 ok');
    expect(previewLinks('visit dehub.io.')).toBe('visit riftn.com.');
  });

  it('leaves subdomains, emails and lookalikes alone', () => {
    for (const s of ['https://staging.dehub.io/x', 'me@dehub.io', 'notdehub.io', 'dehub.io.evil.com', 'https://riftn.com/app']) {
      expect(previewLinks(s)).toBe(s);
    }
  });
});
