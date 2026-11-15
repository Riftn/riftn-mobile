// Prints how big the iOS app is and what makes it big.
// 1. Apple's own numbers for the newest App Store build: download and
//    install size per iPhone model (what the App Store listing shows).
// 2. The newest finished production .ipa from EAS, opened up: every
//    framework, resource bundle and large file with its unzipped size.
// Read only: nothing is changed on Apple or Expo.
import { createSign } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const APP_ID = '6770382811';
const PROJECT = '@dehubapp/dehubmobile';
const BUNDLE = 'io.dehub.mobile';
if (!process.env.EXPO_TOKEN) throw new Error('EXPO_TOKEN is missing');

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const mb = b => `${(b / 1e6).toFixed(1)} MB`;

async function expo(query, variables) {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.EXPO_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors || !json.data) throw new Error(`Expo lookup failed (HTTP ${res.status}) ${JSON.stringify(json.errors ?? '').slice(0, 300)}`);
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
  return data.appStoreConnectApiKey.byId;
}

function token(key) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'ES256', kid: key.keyIdentifier, typ: 'JWT' })}.${b64({ iss: key.issuerIdentifier, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  const sig = createSign('SHA256').update(body).sign({ key: key.keyP8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${body}.${sig}`;
}

const jwt = token(await loadKey());
async function asc(path) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status !== 200) return { error: `HTTP ${res.status} ${(json.errors ?? []).map(e => e.detail ?? e.title).join('; ')}`, data: [], included: [] };
  return { data: json.data ?? [], included: json.included ?? [] };
}

say('## Apple App Store sizes (newest builds)');
const builds = await asc(`/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=3&include=preReleaseVersion,buildBundles`);
if (builds.error) say(`- could not read builds: ${builds.error}`);
for (const b of builds.data) {
  const pre = builds.included.find(i => i.type === 'preReleaseVersions' && i.id === b.relationships?.preReleaseVersion?.data?.id);
  say(`### ${pre?.attributes?.version ?? '?'} (build ${b.attributes.version}), uploaded ${b.attributes.uploadedDate?.slice(0, 10)}`);
  for (const ref of b.relationships?.buildBundles?.data ?? []) {
    const bundle = builds.included.find(i => i.type === 'buildBundles' && i.id === ref.id);
    say(`- bundle ${bundle?.attributes?.bundleId ?? ref.id} (${bundle?.attributes?.bundleType ?? '?'})`);
    const sizes = await asc(`/v1/buildBundles/${ref.id}/buildBundleFileSizes?limit=200`);
    if (sizes.error) { say(`  - could not read sizes: ${sizes.error}`); continue; }
    const rows = sizes.data.map(s => s.attributes).sort((a, c) => (c.installBytes ?? 0) - (a.installBytes ?? 0));
    for (const r of rows.filter(r => /Universal|iPhone1[5-8]|iPhone14/.test(r.deviceModel ?? '')).slice(0, 12)) {
      say(`  - ${r.deviceModel} iOS ${r.osVersion}: download ${mb(r.downloadBytes)}, install ${mb(r.installBytes)}`);
    }
    if (rows.length) say(`  - range over ${rows.length} devices: download ${mb(Math.min(...rows.map(r => r.downloadBytes)))}-${mb(Math.max(...rows.map(r => r.downloadBytes)))}, install ${mb(Math.min(...rows.map(r => r.installBytes)))}-${mb(Math.max(...rows.map(r => r.installBytes)))}`);
  }
}

say('');
say('## Newest production .ipa from EAS');
const list = JSON.parse(execFileSync('eas', ['build:list', '--platform', 'ios', '--status', 'finished', '--limit', '10', '--json', '--non-interactive'], { encoding: 'utf8', maxBuffer: 50e6 }));
const ipa = list.find(b => b.buildProfile === 'production' && b.artifacts?.buildUrl) ?? list.find(b => b.artifacts?.buildUrl);
if (!ipa) throw new Error('No finished iOS build with an archive');
say(`- ${ipa.appVersion} (${ipa.appBuildVersion}), profile ${ipa.buildProfile}, commit ${ipa.gitCommitHash?.slice(0, 7)}, finished ${ipa.completedAt?.slice(0, 10)}`);
writeFileSync('ipa-url.txt', ipa.artifacts.buildUrl);
writeFileSync('size-report.md', lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
