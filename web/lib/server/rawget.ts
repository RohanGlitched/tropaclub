import 'server-only';
import https from 'node:https';
import http from 'node:http';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const unzip = promisify(gunzip);

export type RawResponse = { status: number; etag: string | null; text: string };

/**
 * A plain GET to the public data bucket, outside Next's patched fetch. Pages here are cached and
 * re-rendered in the background (ISR); inside that render Next refuses an uncached fetch (it throws
 * "static to dynamic") and a cached one would keep one copy per minute-stamped URL. This reads the
 * file directly, so a page always gets the current file and Next's data cache holds nothing.
 */
export function rawGet(url: string, opts: { timeoutMs: number; etag?: string | null }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const headers: Record<string, string> = { 'accept-encoding': 'gzip' };
    if (opts.etag) headers['if-none-match'] = opts.etag;
    const req = lib.get(u, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const etag = typeof res.headers.etag === 'string' ? res.headers.etag : null;
        const done = (b: Buffer) => resolve({ status: res.statusCode ?? 0, etag, text: b.toString('utf8') });
        if (res.headers['content-encoding'] === 'gzip' && buf.length) unzip(buf).then(done, reject);
        else done(buf);
      });
    });
    req.setTimeout(opts.timeoutMs, () => req.destroy(new Error(`timeout after ${opts.timeoutMs} ms`)));
    req.on('error', reject);
  });
}
