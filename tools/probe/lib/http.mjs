// @ts-check
// Read-only web requests to the TriCaster. Uses node:http instead of fetch so requests can be
// sent from the cable's own address (see bindAddressFor in network.mjs).
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { assertReadOnlyHttp } from './guard.mjs';

/**
 * @typedef {{ host: string, port: number, localAddress?: string }} Target
 * @typedef {{ username: string, password: string }} Credentials
 * @typedef {{
 *   path: string, status: number, ms: number, headers: Record<string, string>,
 *   bytes: number, truncated: boolean, body: string, error?: string, authScheme?: string
 * }} HttpResult
 */

/**
 * GETs an allowed read-only address. Never throws for network errors: they come back as status 0.
 * @param {Target} target
 * @param {string} path
 * @param {{ credentials?: Credentials, timeoutMs?: number, maxBytes?: number }} [options]
 * @returns {Promise<HttpResult>}
 */
export async function readOnlyGet(target, path, { credentials, timeoutMs = 4000, maxBytes = 2_000_000 } = {}) {
  assertReadOnlyHttp('GET', path);
  const first = await rawGet(target, path, undefined, timeoutMs, maxBytes);
  if (first.status !== 401 || !credentials) return first;
  const challenge = first.headers['www-authenticate'] ?? '';
  const authorization = buildAuthorization(challenge, credentials, path);
  if (!authorization) return first;
  const second = await rawGet(target, path, authorization.header, timeoutMs, maxBytes);
  return { ...second, authScheme: authorization.scheme };
}

/**
 * @param {Target} target
 * @param {string} path
 * @param {string | undefined} authorization
 * @param {number} timeoutMs
 * @param {number} maxBytes
 * @returns {Promise<HttpResult>}
 */
function rawGet(target, path, authorization, timeoutMs, maxBytes) {
  const started = Date.now();
  return new Promise((resolve) => {
    /** @type {Record<string, string>} */
    const headers = { 'User-Agent': 'TSTV-Probe (read-only)', Accept: '*/*' };
    if (authorization) headers.Authorization = authorization;
    const req = http.request(
      {
        host: target.host,
        port: target.port,
        localAddress: target.localAddress,
        path,
        method: 'GET',
        headers,
        timeout: timeoutMs,
        agent: false,
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let bytes = 0;
        let truncated = false;
        res.on('data', (/** @type {Buffer} */ chunk) => {
          bytes += chunk.length;
          if (bytes <= maxBytes) chunks.push(chunk);
          else truncated = true;
        });
        res.on('end', () =>
          resolve({
            path,
            status: res.statusCode ?? 0,
            ms: Date.now() - started,
            headers: flattenHeaders(res.headers),
            bytes,
            truncated,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', (err) => resolve(failure(path, started, err)));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'TIMEOUT' })));
    req.on('error', (err) => resolve(failure(path, started, err)));
    req.end();
  });
}

/**
 * @param {string} path
 * @param {number} started
 * @param {Error & { code?: string }} err
 * @returns {HttpResult}
 */
function failure(path, started, err) {
  return { path, status: 0, ms: Date.now() - started, headers: {}, bytes: 0, truncated: false, body: '', error: err.code ?? err.message };
}

/** @param {http.IncomingHttpHeaders} headers */
function flattenHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

/**
 * Builds a Basic or Digest Authorization header for a 401 challenge.
 * @param {string} challenge the WWW-Authenticate header
 * @param {Credentials} credentials
 * @param {string} uri
 * @returns {{ scheme: string, header: string } | undefined}
 */
export function buildAuthorization(challenge, credentials, uri) {
  const scheme = challenge.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (scheme === 'basic' || scheme === '') {
    const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
    return { scheme: 'Basic', header: `Basic ${token}` };
  }
  if (scheme !== 'digest') return undefined;
  /** @type {Record<string, string>} */
  const params = {};
  for (const match of challenge.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
    params[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  const md5 = (/** @type {string} */ s) => createHash('md5').update(s).digest('hex');
  const realm = params.realm ?? '';
  const nonce = params.nonce ?? '';
  const qop = (params.qop ?? '').split(',').map((q) => q.trim()).includes('auth') ? 'auth' : undefined;
  const ha1 = md5(`${credentials.username}:${realm}:${credentials.password}`);
  const ha2 = md5(`GET:${uri}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${credentials.username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (params.opaque) parts.push(`opaque="${params.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return { scheme: 'Digest', header: `Digest ${parts.join(', ')}` };
}
