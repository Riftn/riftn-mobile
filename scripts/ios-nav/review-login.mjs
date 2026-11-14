// The sign-in Apple's reviewers use (App Store Connect, App Review
// Information), for the simulator check: the same account the store build is
// reviewed with, so no second test account has to be kept anywhere.
//
//   node scripts/ios-nav/review-login.mjs          prints the sign-in as one
//                                                  line of JSON on stdout and
//                                                  nothing else: a phone and
//                                                  its fixed code, or recovery
//                                                  words / a key
//   node scripts/ios-nav/review-login.mjs --shape  prints only what kind of
//                                                  sign-in is stored: counts
//                                                  and yes/no, never a value
//
// This repository is public, so are its logs: nothing read from Apple is ever
// printed outside the first form, and that one is only ever captured into a
// shell variable. Uses the App Store Connect key stored with the Expo project.
import { createSign } from 'node:crypto';

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

async function appStoreToken() {
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
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'ES256', kid: key.keyIdentifier, typ: 'JWT' })}.${b64({ iss: key.issuerIdentifier, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const sig = createSign('SHA256').update(body).sign({ key: key.keyP8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${body}.${sig}`;
}

async function apple(jwt, path) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(30_000),
  });
  // Never the body: an error from this endpoint can quote the record.
  if (res.status !== 200) throw new Error(`App Store Connect answered HTTP ${res.status} for ${path.split('?')[0].replace(/[0-9a-f-]{20,}/g, ':id')}`);
  return res.json();
}

/** Recovery words: 12 to 24 lowercase words in steps of three. */
const WORDS = /(?:^|[^a-z])((?:[a-z]{3,8}[ \t]+){11,23}[a-z]{3,8})(?![a-z])/;
/** A private key: 64 hex digits, with or without 0x. */
const KEY = /(?:^|[^0-9a-fA-F])((?:0x)?[0-9a-fA-F]{64})(?![0-9a-fA-F])/;

/** The first thing in a field that Import wallet would take. */
export function importSecretIn(text) {
  const value = String(text ?? '');
  const key = value.match(KEY)?.[1];
  if (key) return key;
  const words = value.match(WORDS)?.[1]?.trim().split(/\s+/);
  return words && words.length % 3 === 0 ? words.join(' ') : null;
}

async function reviewDetail() {
  const jwt = await appStoreToken();
  const versions = await apple(jwt, `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=5`);
  for (const version of versions.data ?? []) {
    const detail = await apple(jwt, `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => null);
    const a = detail?.data?.attributes;
    if (a && (a.demoAccountName || a.demoAccountPassword || a.notes)) return { version: version.attributes?.versionString, ...a };
  }
  return null;
}

/** A phone number as the sign-in takes it: + and digits only. */
function phoneIn(text) {
  const value = String(text ?? '').trim();
  if (!/^\+?[0-9 ()-]{7,}$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

const detail = await reviewDetail();
const fields = detail ? [detail.demoAccountPassword, detail.demoAccountName, detail.notes] : [];
const secret = fields.map(importSecretIn).find(Boolean) ?? null;
// Reviewers cannot receive a text message, so their number signs in with a
// code that never changes (request-phone-otp's reviewer path).
const phone = phoneIn(detail?.demoAccountName);
const code = /^\d{6}$/.test(String(detail?.demoAccountPassword ?? '').trim()) ? String(detail.demoAccountPassword).trim() : null;
const signIn = secret ? { secret } : phone && code ? { phone, code } : null;

if (process.argv.includes('--shape')) {
  const kind = v => {
    const s = String(v ?? '').trim();
    if (!s) return 'empty';
    if (KEY.test(s) && s.replace(/^0x/, '').length === 64) return 'a private key';
    const words = s.split(/\s+/);
    if (words.length >= 12 && words.length % 3 === 0 && words.every(w => /^[a-z]+$/.test(w))) return `${words.length} recovery words`;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'an email address';
    if (/^\+?[0-9 ()-]{7,}$/.test(s)) return 'a phone number';
    return `other text (${s.length} characters, ${words.length} word${words.length === 1 ? '' : 's'})`;
  };
  const notes = String(detail?.notes ?? '');
  const mentions = ['recovery', 'phrase', 'seed', 'private key', 'import', 'wallet', 'email', 'code', 'password', 'google', 'apple', 'phone']
    .filter(w => notes.toLowerCase().includes(w));
  console.log('## Apple review sign-in (shape only, no values)');
  if (!detail) console.log('- no review sign-in is stored on the newest versions');
  else {
    console.log(`- stored on version ${detail.version}, demo account required: ${detail.demoAccountRequired}`);
    console.log(`- user name field: ${kind(detail.demoAccountName)}`);
    console.log(`- password field: ${kind(detail.demoAccountPassword)}`);
    console.log(`- notes: ${notes.length} characters, mention: ${mentions.join(', ') || 'none of the sign-in words'}`);
    console.log(`- notes hold recovery words or a key: ${importSecretIn(notes) ? 'yes' : 'no'}`);
    console.log(`- usable by the simulator: ${secret ? 'yes, recovery words or key' : phone && code ? 'yes, phone number with a fixed 6-digit code' : 'no'}`);
  }
} else {
  if (!signIn) {
    console.error('The review sign-in is neither a phone number with a 6-digit code nor recovery words or a key.');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(signIn));
}
