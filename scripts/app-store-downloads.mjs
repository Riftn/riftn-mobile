// Prints how many times the iOS app has been downloaded.
// Two sources, both read with the App Store Connect team key stored on the
// Expo project (the key never leaves this process and is never printed):
// - Sales and Trends daily summaries, when the vendor number is known
//   (ASC_VENDOR_NUMBER). Ready the morning after each day, US time.
// - App Analytics reports. The first run asks Apple to start making them
//   (a one-off history snapshot plus a daily feed); Apple takes about a day
//   to deliver the first ones, later runs read them.
import { createSign } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const APP_ID = '6770382811';
const PROJECT = '@dehubapp/dehubmobile';
const BUNDLE = 'io.dehub.mobile';
const DAYS = Number(process.env.DAYS || 30);
const VENDOR = (process.env.ASC_VENDOR_NUMBER ?? '').trim();

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

const key = await loadKey();
function token() {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'ES256', kid: key.keyIdentifier, typ: 'JWT' })}.${b64({ iss: key.issuerIdentifier, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })}`;
  const sig = createSign('SHA256').update(body).sign({ key: key.keyP8, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${body}.${sig}`;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path.startsWith('http') ? path : `https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status >= 300) {
    let detail = '';
    try { detail = (JSON.parse(buf.toString()).errors ?? []).map(e => `${e.code}: ${e.detail ?? e.title}`).join('; '); } catch { detail = buf.toString().slice(0, 200); }
    return { status: res.status, error: `HTTP ${res.status} ${detail}` };
  }
  return { status: res.status, buf };
}
const json = r => (r.error ? r : { ...r, ...JSON.parse(r.buf.toString() || '{}') });

function tsv(buf) {
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
  const [head, ...rows] = text.split('\n').filter(Boolean);
  const cols = head.split('\t');
  return rows.map(r => Object.fromEntries(r.split('\t').map((v, i) => [cols[i], v])));
}

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const day = d => d.toISOString().slice(0, 10);
const fmt = n => n.toLocaleString('en-GB');

// ---- Sales and Trends ----
say('## Sales and Trends (iPhone downloads)');
if (!VENDOR) {
  say('- skipped: no vendor number set (repo variable ASC_VENDOR_NUMBER)');
} else {
  // Product type 1/1F/1T/F1 = first download, 3/3F/3T/F3 = redownload, 7/7F/7T/F7 = update.
  const kind = t => (/^(1|1F|1T|F1)$/.test(t) ? 'first' : /^(3|3F|3T|F3)$/.test(t) ? 're' : /^(7|7F|7T|F7)$/.test(t) ? 'update' : 'other');
  const totals = { first: 0, re: 0, update: 0, other: 0 };
  const perDay = [];
  const countries = {};
  for (let i = DAYS; i >= 1; i--) {
    const d = day(new Date(Date.now() - i * 86400_000));
    const r = await api(`/v1/salesReports?filter[frequency]=DAILY&filter[reportType]=SALES&filter[reportSubType]=SUMMARY&filter[vendorNumber]=${VENDOR}&filter[reportDate]=${d}&filter[version]=1_1`);
    if (r.status === 404) continue; // no sales that day, or not ready yet
    if (r.error) { say(`- ${d}: ${r.error}`); if (r.status === 401 || r.status === 403) break; continue; }
    const rows = tsv(r.buf).filter(x => x['Apple Identifier'] === APP_ID);
    const t = { first: 0, re: 0, update: 0, other: 0 };
    for (const x of rows) {
      const k = kind(x['Product Type Identifier']);
      const units = Number(x.Units) || 0;
      t[k] += units; totals[k] += units;
      if (k === 'first') countries[x['Country Code']] = (countries[x['Country Code']] ?? 0) + units;
    }
    perDay.push([d, t]);
  }
  say(`- last ${DAYS} days: ${fmt(totals.first)} first-time downloads, ${fmt(totals.re)} redownloads, ${fmt(totals.update)} updates`);
  for (const [d, t] of perDay) say(`  - ${d}: ${t.first} new, ${t.re} redownloads, ${t.update} updates`);
  const top = Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (top.length) say(`- top countries (new downloads): ${top.map(([c, n]) => `${c} ${n}`).join(', ')}`);
}

// ---- App Analytics ----
say('');
say('## App Analytics (App Store downloads)');
const reqs = json(await api(`/v1/apps/${APP_ID}/analyticsReportRequests?limit=10`));
if (reqs.error) {
  say(`- could not read report requests: ${reqs.error}`);
} else {
  const have = new Map((reqs.data ?? []).filter(r => !r.attributes.stoppedDueToInactivity).map(r => [r.attributes.accessType, r]));
  for (const accessType of ['ONE_TIME_SNAPSHOT', 'ONGOING']) {
    if (have.has(accessType)) continue;
    const made = json(await api('/v1/analyticsReportRequests', 'POST', {
      data: { type: 'analyticsReportRequests', attributes: { accessType }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } },
    }));
    say(made.error ? `- could not ask Apple for ${accessType} reports: ${made.error}` : `- asked Apple to start ${accessType} reports (first files usually arrive within a day)`);
    if (!made.error) have.set(accessType, made.data);
  }
  const byDay = {};
  const seen = new Set();
  for (const [accessType, req] of have) {
    const reps = json(await api(`/v1/analyticsReportRequests/${req.id}/reports?filter[category]=COMMERCE&limit=50`));
    if (reps.error) { say(`- ${accessType}: ${reps.error}`); continue; }
    const dl = (reps.data ?? []).filter(r => /download/i.test(r.attributes.name) && /standard/i.test(r.attributes.name));
    say(`- ${accessType}: ${(reps.data ?? []).length} commerce reports listed${dl.length ? `, using "${dl.map(r => r.attributes.name).join('", "')}"` : ''}`);
    for (const rep of dl) {
      const inst = json(await api(`/v1/analyticsReports/${rep.id}/instances?filter[granularity]=DAILY&limit=200`));
      if (inst.error) { say(`  - instances: ${inst.error}`); continue; }
      say(`  - ${(inst.data ?? []).length} daily files ready`);
      for (const i of inst.data ?? []) {
        const segs = json(await api(`/v1/analyticsReportInstances/${i.id}/segments?limit=50`));
        if (segs.error) continue;
        for (const s of segs.data ?? []) {
          if (seen.has(s.attributes.checksum)) continue;
          seen.add(s.attributes.checksum);
          const file = await fetch(s.attributes.url, { signal: AbortSignal.timeout(60_000) });
          if (!file.ok) continue;
          for (const row of tsv(Buffer.from(await file.arrayBuffer()))) {
            const d = row.Date;
            const type = row['Download Type'] ?? 'unknown';
            const n = Number(row.Counts) || 0;
            byDay[d] ??= {};
            byDay[d][type] = (byDay[d][type] ?? 0) + n;
          }
        }
      }
    }
  }
  const daysSeen = Object.keys(byDay).sort();
  if (!daysSeen.length) {
    say('- no download numbers yet (Apple is still preparing the reports; run again tomorrow)');
  } else {
    const all = {};
    for (const d of daysSeen) for (const [t, n] of Object.entries(byDay[d])) all[t] = (all[t] ?? 0) + n;
    say(`- all days ${daysSeen[0]} to ${daysSeen.at(-1)}: ${Object.entries(all).map(([t, n]) => `${t} ${fmt(n)}`).join(', ')}`);
    for (const d of daysSeen.slice(-14)) say(`  - ${d}: ${Object.entries(byDay[d]).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
