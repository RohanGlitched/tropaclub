// GCS access: @google-cloud/storage with ADC (Cloud Run), or the gcloud CLI locally (no ADC on the dev box).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BUCKET } from './config.ts';

const useCli = () => process.env.GCS_MODE === 'cli' || (process.env.GCS_MODE !== 'sdk' && !process.env.K_SERVICE && !process.env.CLOUD_RUN_JOB);

function gcloud(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn('gcloud', args, { shell: process.platform === 'win32' });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code: code ?? 1, out, err }));
  });
}

let _storage: any = null;
async function bucket() {
  if (!_storage) {
    const { Storage } = await import('@google-cloud/storage');
    _storage = new Storage();
  }
  return _storage.bucket(BUCKET);
}

export async function download(object: string, local: string): Promise<boolean> {
  fs.mkdirSync(path.dirname(local), { recursive: true });
  if (useCli()) {
    const r = await gcloud(['storage', 'cp', `gs://${BUCKET}/${object}`, local]);
    if (r.code !== 0) { if (/No URLs matched|not found|404/i.test(r.err)) return false; throw new Error('gcloud download failed: ' + r.err.slice(0, 300)); }
    return true;
  }
  const f = (await bucket()).file(object);
  const [exists] = await f.exists();
  if (!exists) return false;
  await f.download({ destination: local });
  return true;
}

export interface UploadOpts { cacheControl?: string; contentType?: string; gzip?: boolean }

// Upload a list of [localPath, objectName] pairs.
export async function uploadMany(files: [string, string][], opts: UploadOpts): Promise<void> {
  if (!files.length) return;
  if (useCli()) {
    // group by destination directory so one gcloud call can copy many files
    const groups = new Map<string, string[]>();
    for (const [l, o] of files) {
      const dir = o.slice(0, o.lastIndexOf('/') + 1);
      if (path.basename(l) !== o.slice(dir.length)) throw new Error('cli upload needs matching basenames');
      groups.set(dir, [...(groups.get(dir) || []), l]);
    }
    for (const [dir, ls] of groups) {
      // Windows caps command lines at ~8k chars: when a group is a whole local directory, hand gcloud a wildcard.
      const localDirs = new Set(ls.map((l) => path.dirname(l)));
      const whole = localDirs.size === 1 && fs.readdirSync([...localDirs][0]).length === ls.length;
      const parts = whole && ls.length > 10 ? [[path.join([...localDirs][0], '*')]] : Array.from({ length: Math.ceil(ls.length / 40) }, (_, k) => ls.slice(k * 40, k * 40 + 40));
      for (const part of parts) {
        const args = ['storage', 'cp', ...part, `gs://${BUCKET}/${dir}`];
        if (opts.cacheControl) args.push(`--cache-control=${opts.cacheControl}`);
        if (opts.contentType) args.push(`--content-type=${opts.contentType}`);
        if (opts.gzip) args.push('--gzip-local-all');
        const r = await gcloud(args.map((a) => (process.platform === 'win32' && /[ ,]/.test(a) ? `"${a}"` : a)));
        if (r.code !== 0) throw new Error('gcloud upload failed: ' + r.err.slice(0, 500));
      }
    }
    return;
  }
  const b = await bucket();
  let i = 0;
  async function w() {
    while (i < files.length) {
      const [l, o] = files[i++];
      for (let att = 0; ; att++) {
        try {
          await b.upload(l, { destination: o, gzip: !!opts.gzip, resumable: false, metadata: { cacheControl: opts.cacheControl, contentType: opts.contentType } });
          break;
        } catch (e) { if (att >= 4) throw e; await new Promise((r) => setTimeout(r, 1000 * (att + 1))); }
      }
    }
  }
  await Promise.all(Array.from({ length: 16 }, w));
}
