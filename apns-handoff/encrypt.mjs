// One-off: reads the app's Apple push key from Expo and prints it encrypted
// to the server's handoff public key (RSA-OAEP SHA-256). Only the server can
// read the output. Nothing secret is printed.
import { publicEncrypt, constants, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PROJECT = '@dehubapp/dehubmobile';
const BUNDLE = 'io.dehub.mobile';
if (!process.env.EXPO_TOKEN) throw new Error('EXPO_TOKEN is missing');

async function expo(query, variables) {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.EXPO_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors || !json.data) throw new Error(`Expo lookup failed (HTTP ${res.status}) ${JSON.stringify(json.errors?.map(e => e.message) ?? [])}`);
  return json.data;
}

const data = await expo(`query($p: String!) { app { byFullName(fullName: $p) { iosAppCredentials {
  appleAppIdentifier { bundleIdentifier }
  pushKey { keyIdentifier keyP8 appleTeam { appleTeamIdentifier } }
} } } }`, { p: PROJECT });
const keys = (data.app?.byFullName?.iosAppCredentials ?? [])
  .filter(r => r.appleAppIdentifier?.bundleIdentifier === BUNDLE && r.pushKey?.keyP8);
if (keys.length === 0) throw new Error('No push key on the Expo project for this app');
const key = keys[0].pushKey;
console.log(`push key id ${key.keyIdentifier}, team ${key.appleTeam?.appleTeamIdentifier ?? '?'}`);
createPrivateKey(key.keyP8); // throws if it is not a usable key
const body = key.keyP8.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
const payload = Buffer.from(JSON.stringify({ k: key.keyIdentifier, p: body }));
const cipher = publicEncrypt(
  { key: readFileSync(new URL('./public.pem', import.meta.url)), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  payload,
);
console.log('----- ciphertext -----');
console.log(cipher.toString('base64'));
