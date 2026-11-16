// Prints where the iOS app stands with Apple: App Store versions, review
// submissions and TestFlight beta review for the newest builds.
// With RELEASE_IF_APPROVED=true it also releases a version that Apple has
// approved and is waiting on us ("Pending Developer Release"); nothing else
// is ever changed, apart from the promotional text when PROMOTIONAL_TEXT is
// given (Apple allows that line to change without a review), and with
// SUBMIT_VERSION it sends that version's newest processed build to App Review.
// Uses the App Store Connect team key stored with the Expo project; the key
// never leaves this process and is never printed.
import { createSign } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const APP_ID = '6770382811';
const PROJECT = '@dehubapp/dehubmobile';
const BUNDLE = 'io.dehub.mobile';

if (!process.env.EXPO_TOKEN) throw new Error('EXPO_TOKEN is missing');

async function expo(query, variables) {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.EXPO_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors || !json.data) throw new Error(`Expo lookup failed (HTTP ${res.status})`);
  return json.data;
}

async function loadKey() {
  const meta = await expo(`query($p: String!) { app { byFullName(fullName: $p) { iosAppCredentials {
    appleAppIdentifier { bundleIdentifier }
    appStoreConnectApiKeyForSubmissions { id }
  } } } }`, { p: PROJECT });
  const ids = new Set((meta.app?.byFullName?.iosAppCredentials ?? [])
    .filter(r => r.appleAppIdentifier?.bundleIdentifier === BUNDLE)
    .map(r => r.appStoreConnectApiKeyForSubmissions?.id).filter(Boolean));
  if (ids.size !== 1) throw new Error('Could not find exactly one App Store Connect key on the Expo project');
  const data = await expo(`query($id: ID!) { appStoreConnectApiKey { byId(id: $id) {
    issuerIdentifier keyIdentifier keyP8 } } }`, { id: [...ids][0] });
  const key = data.appStoreConnectApiKey?.byId;
  if (!key?.keyP8 || !key.issuerIdentifier || !key.keyIdentifier) throw new Error('App Store Connect key is incomplete');
  return key;
}

function token(key) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'ES256', kid: key.keyIdentifier, typ: 'JWT' })}.${b64({ iss: key.issuerIdentifier, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  const sig = createSign('SHA256').update(body).sign({ key: key.keyP8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${body}.${sig}`;
}

const jwt = token(await loadKey());

async function get(path, method = 'GET', body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
    const detail = (json.errors ?? []).map(e => `${e.code}: ${e.detail ?? e.title}`).join('; ');
    return { error: `HTTP ${res.status} ${detail}`, data: [], included: [] };
  }
  return { data: json.data ?? [], included: json.included ?? [] };
}

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

say('## App Store versions (newest first)');
const versions = await get(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=5&include=build`);
if (versions.error) say(`- could not read: ${versions.error}`);
for (const v of versions.data) {
  const a = v.attributes;
  const buildId = v.relationships?.build?.data?.id;
  const build = versions.included.find(i => i.type === 'builds' && i.id === buildId);
  say(`- ${a.versionString} (build ${build?.attributes?.version ?? '?'}): ${a.appVersionState ?? a.appStoreState} [appStoreState ${a.appStoreState}], release ${a.releaseType ?? '?'}, created ${a.createdDate?.slice(0, 16) ?? '?'}`);
}

say('');
say('## Review submissions (newest first)');
const subs = await get(`/v1/apps/${APP_ID}/reviewSubmissions?filter[platform]=IOS&limit=5`);
if (subs.error) say(`- could not read: ${subs.error}`);
for (const s of subs.data) say(`- ${s.attributes.state}, submitted ${s.attributes.submittedDate?.slice(0, 16) ?? 'not yet'}`);

say('');
say('## TestFlight builds (newest first)');
const builds = await get(`/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=4&include=betaAppReviewSubmission,preReleaseVersion,buildBetaDetail`);
if (builds.error) say(`- could not read: ${builds.error}`);
const inc = (type, rel) => builds.included.find(i => i.type === type && i.id === rel?.data?.id);
for (const b of builds.data) {
  const pre = inc('preReleaseVersions', b.relationships?.preReleaseVersion);
  const review = inc('betaAppReviewSubmissions', b.relationships?.betaAppReviewSubmission);
  const detail = inc('buildBetaDetails', b.relationships?.buildBetaDetail);
  say(`- ${pre?.attributes?.version ?? '?'} (${b.attributes.version}): processing ${b.attributes.processingState}${b.attributes.expired ? ', EXPIRED' : ''}, beta review ${review?.attributes?.betaReviewState ?? 'not submitted'}, internal ${detail?.attributes?.internalBuildState ?? '?'}, external ${detail?.attributes?.externalBuildState ?? '?'}, uploaded ${b.attributes.uploadedDate?.slice(0, 16) ?? '?'}`);
}

say('');
say('## Store listing text');
const clip = (t, n = 140) => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const infos = await get(`/v1/apps/${APP_ID}/appInfos?include=appInfoLocalizations`);
if (infos.error) say(`- could not read app info: ${infos.error}`);
for (const info of infos.data) {
  say(`- app info ${info.attributes.appStoreState ?? info.attributes.state ?? '?'}`);
  for (const l of infos.included.filter(i => i.type === 'appInfoLocalizations' && info.relationships?.appInfoLocalizations?.data?.some(d => d.id === i.id))) {
    say(`  - ${l.attributes.locale}: name "${l.attributes.name ?? ''}", subtitle "${l.attributes.subtitle ?? ''}"`);
  }
}
const newest = versions.data[0];
let versionLocales = [];
if (newest) {
  const locs = await get(`/v1/appStoreVersions/${newest.id}/appStoreVersionLocalizations?limit=50`);
  if (locs.error) say(`- could not read ${newest.attributes.versionString} text: ${locs.error}`);
  versionLocales = locs.data;
  for (const l of versionLocales) {
    say(`- ${newest.attributes.versionString} ${l.attributes.locale}: promo "${clip(l.attributes.promotionalText)}", description "${clip(l.attributes.description)}"`);
  }
}

// Promotional text is the one listing line Apple lets us change at any time
// without a review, so it never touches a version waiting to be released.
const promo = (process.env.PROMOTIONAL_TEXT ?? '').trim();
if (promo) {
  say('');
  say('## Promotional text');
  if (promo.length > 170) throw new Error('Promotional text is limited to 170 characters');
  for (const l of versionLocales) {
    const done = await get(`/v1/appStoreVersionLocalizations/${l.id}`, 'PATCH', {
      data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { promotionalText: promo } },
    });
    say(done.error ? `- ${l.attributes.locale} failed: ${done.error}` : `- ${l.attributes.locale} set to "${promo}"`);
    if (done.error) process.exitCode = 1;
  }
}

if (process.env.RELEASE_IF_APPROVED === 'true') {
  say('');
  say('## Release');
  const waiting = versions.data.find(v => v.attributes.appStoreState === 'PENDING_DEVELOPER_RELEASE');
  if (!waiting) {
    say('- nothing approved and waiting to be released');
  } else {
    const released = await get('/v1/appStoreVersionReleaseRequests', 'POST', {
      data: { type: 'appStoreVersionReleaseRequests', relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: waiting.id } } } },
    });
    say(released.error
      ? `- release of ${waiting.attributes.versionString} failed: ${released.error}`
      : `- ${waiting.attributes.versionString} released to the App Store (it shows up within a few hours)`);
    if (released.error) process.exitCode = 1;
  }
}

// Sends a version to App Review: makes the version if it is not there yet,
// attaches the newest processed build of it, sets the "What's New" line and
// submits. Released by Apple as soon as it is approved.
const submitVersion = (process.env.SUBMIT_VERSION ?? '').trim();
if (submitVersion) {
  say('');
  say(`## Submit ${submitVersion} for review`);
  const fail = (why) => { say(`- stopped: ${why}`); process.exitCode = 1; };
  await (async () => {
    const whatsNew = (process.env.WHATS_NEW ?? '').trim();
    if (!whatsNew) return fail("the What's New text is empty");
    const candidates = await get(`/v1/builds?filter[app]=${APP_ID}&filter[preReleaseVersion.version]=${encodeURIComponent(submitVersion)}&filter[processingState]=VALID&filter[expired]=false&sort=-uploadedDate&limit=1`);
    if (candidates.error) return fail(candidates.error);
    const build = candidates.data[0];
    if (!build) return fail(`no processed build of ${submitVersion} yet (still uploading or processing)`);
    say(`- build ${build.attributes.version}, uploaded ${build.attributes.uploadedDate?.slice(0, 16)}`);

    let version = versions.data.find(v => v.attributes.versionString === submitVersion);
    if (!version) {
      const made = await get('/v1/appStoreVersions', 'POST', {
        data: {
          type: 'appStoreVersions',
          attributes: { platform: 'IOS', versionString: submitVersion, releaseType: 'AFTER_APPROVAL' },
          relationships: { app: { data: { type: 'apps', id: APP_ID } } },
        },
      });
      if (made.error) return fail(`could not make the version: ${made.error}`);
      version = made.data;
      say('- version made');
    }
    const state = version.attributes.appStoreState;
    if (!['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(state)) {
      return fail(`${submitVersion} is ${state}, nothing to submit`);
    }

    const attached = await get(`/v1/appStoreVersions/${version.id}/relationships/build`, 'PATCH', { data: { type: 'builds', id: build.id } });
    if (attached.error) return fail(`could not attach the build: ${attached.error}`);
    say('- build attached');

    const locs = await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
    if (locs.error) return fail(locs.error);
    for (const l of locs.data) {
      const done = await get(`/v1/appStoreVersionLocalizations/${l.id}`, 'PATCH', {
        data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew } },
      });
      if (done.error) return fail(`What's New for ${l.attributes.locale}: ${done.error}`);
    }
    say(`- What's New set for ${locs.data.length} language(s)`);

    // One open submission per platform: reuse it if an earlier try left one.
    const open = await get(`/v1/apps/${APP_ID}/reviewSubmissions?filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=1`);
    if (open.error) return fail(open.error);
    let submission = open.data[0];
    if (!submission) {
      const made = await get('/v1/reviewSubmissions', 'POST', {
        data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } },
      });
      if (made.error) return fail(`could not open a submission: ${made.error}`);
      submission = made.data;
    }
    const items = await get(`/v1/reviewSubmissions/${submission.id}/items?limit=10`);
    if (items.error) return fail(items.error);
    if (!items.data.length) {
      const item = await get('/v1/reviewSubmissionItems', 'POST', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
          },
        },
      });
      if (item.error) return fail(`could not add the version to the submission: ${item.error}`);
    }
    const sent = await get(`/v1/reviewSubmissions/${submission.id}`, 'PATCH', {
      data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
    });
    if (sent.error) return fail(`submit failed: ${sent.error}`);
    say(`- ${submitVersion} (build ${build.attributes.version}) submitted for review`);
  })();
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
