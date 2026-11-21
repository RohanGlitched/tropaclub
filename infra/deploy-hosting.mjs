// Deploy a static dir + config to Firebase Hosting via the REST API using gcloud user creds.
// usage: node deploy-hosting.mjs <dir> [configJson]
import { execSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import crypto from 'node:crypto';
const PROJECT = 'project-5523359e-5941-4df4-998', SITE = process.env.SITE || 'tropaclub';
const dir = process.argv[2]; const config = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {};
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8', shell: true }).trim();
const H = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT, 'content-type': 'application/json' };
const api = async (method, url, body) => { const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${url} ${r.status} ${t}`); return t ? JSON.parse(t) : {}; };
const base = 'https://firebasehosting.googleapis.com/v1beta1';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = {}; const blobs = {};
for (const f of walk(dir)) { const gz = zlib.gzipSync(fs.readFileSync(f), { level: 9 }); const h = crypto.createHash('sha256').update(gz).digest('hex'); files['/' + path.relative(dir, f).split(path.sep).join('/')] = h; blobs[h] = gz; }
const v = await api('POST', `${base}/sites/${SITE}/versions`, { config });
const pop = await api('POST', `${base}/${v.name}:populateFiles`, { files });
for (const h of pop.uploadRequiredHashes || []) { const r = await fetch(`${pop.uploadUrl}/${h}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body: blobs[h] }); if (!r.ok) throw new Error('upload ' + h + ' ' + r.status); }
await api('PATCH', `${base}/${v.name}?update_mask=status`, { status: 'FINALIZED' });
const rel = await api('POST', `${base}/sites/${SITE}/releases?versionName=${v.name}`, {});
console.log('released', rel.name, Object.keys(files).length, 'files');
