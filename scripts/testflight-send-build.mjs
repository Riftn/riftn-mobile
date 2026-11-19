// Gives a processed TestFlight build to a tester group and, for an outside
// group, sends it to Apple's beta review. Without a build number it takes the
// newest build that has finished processing.
// Uses the App Store Connect team key already stored with the Expo project.
// The key never leaves this process and is never printed.
import { createSign } from 'node:crypto';

const APP_ID = '6770382811';
const PROJECT = '@dehubapp/dehubmobile';
const BUNDLE = 'io.dehub.mobile';

const groupName = (process.env.TESTER_GROUP ?? 'Dev testers').trim();
const wantedBuild = (process.env.BUILD_NUMBER ?? '').trim();
const whatToTest = (process.env.WHAT_TO_TEST ?? '').trim();

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

const key = await loadKey();
const jwt = token(key);

async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { status: res.status, json };
}

function fail(step, r) {
  const detail = (r.json.errors ?? []).map(e => `${e.code}: ${e.detail ?? e.title}`).join('; ');
  throw new Error(`${step} failed (HTTP ${r.status}) ${detail}`);
}

const groupsRes = await asc('GET', `/v1/apps/${APP_ID}/betaGroups?limit=50&fields[betaGroups]=name,isInternalGroup`);
if (groupsRes.status !== 200) fail('Listing TestFlight groups', groupsRes);
const group = (groupsRes.json.data ?? []).find(g => g.attributes.name.toLowerCase() === groupName.toLowerCase());
if (!group) throw new Error(`No TestFlight group called "${groupName}"`);

const filter = wantedBuild ? `&filter[version]=${encodeURIComponent(wantedBuild)}` : '';
const buildsRes = await asc('GET', `/v1/builds?filter[app]=${APP_ID}${filter}&sort=-uploadedDate&limit=10&include=preReleaseVersion,betaAppReviewSubmission,buildBetaDetail&fields[builds]=version,processingState,uploadedDate,expired&fields[preReleaseVersions]=version`);
if (buildsRes.status !== 200) fail('Listing builds', buildsRes);
const included = buildsRes.json.included ?? [];
const find = (type, rel) => included.find(x => x.type === type && x.id === rel?.data?.id);
const build = (buildsRes.json.data ?? []).find(b => b.attributes.processingState === 'VALID' && !b.attributes.expired);
if (!build) {
  const seen = (buildsRes.json.data ?? []).map(b => `${b.attributes.version} ${b.attributes.processingState}`).join(', ');
  throw new Error(`No processed build to send yet (${seen || 'none uploaded'})`);
}
const version = find('preReleaseVersions', build.relationships?.preReleaseVersion)?.attributes?.version ?? '?';
console.log(`Build ${version} (${build.attributes.version}), uploaded ${build.attributes.uploadedDate}`);

if (whatToTest) {
  const locs = await asc('GET', `/v1/builds/${build.id}/betaBuildLocalizations?limit=20`);
  if (locs.status !== 200) fail('Reading test notes', locs);
  const first = (locs.json.data ?? [])[0];
  const saved = first
    ? await asc('PATCH', `/v1/betaBuildLocalizations/${first.id}`, { data: { type: 'betaBuildLocalizations', id: first.id, attributes: { whatsNew: whatToTest } } })
    : await asc('POST', '/v1/betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-GB', whatsNew: whatToTest }, relationships: { build: { data: { type: 'builds', id: build.id } } } } });
  if (saved.status >= 300) fail('Saving test notes', saved);
  console.log('Test notes saved');
}

const added = await asc('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });
if (added.status >= 300 && added.status !== 409) fail('Adding the build to the group', added);
console.log(`In group "${group.attributes.name}"`);

if (group.attributes.isInternalGroup) {
  console.log('Inside group: testers can install it now');
} else {
  const review = find('betaAppReviewSubmissions', build.relationships?.betaAppReviewSubmission);
  if (review) {
    console.log(`Beta review: ${review.attributes?.betaReviewState}`);
  } else {
    const sent = await asc('POST', '/v1/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } });
    if (sent.status >= 300) {
      const detail = (sent.json.errors ?? []).map(e => `${e.code}: ${e.detail ?? e.title}`).join('; ');
      // Apple reviews only the first build of a version; later ones go straight out.
      console.log(`Beta review not opened (HTTP ${sent.status}) ${detail}`);
    } else {
      console.log(`Beta review: ${sent.json.data?.attributes?.betaReviewState ?? 'sent'}`);
    }
  }
}
