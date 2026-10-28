// @ts-check
// A minimal WebSocket client that only listens. Node's built-in WebSocket can't send from a chosen
// local address, which a Mac needs when both Wi-Fi and the cable have automatic addresses.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { assertReadOnlyWsMessage, assertReadOnlyWsPath, WS_KEEPALIVE_MESSAGE } from './guard.mjs';

/**
 * @typedef {import('./http.mjs').Target} Target
 * @typedef {{ status: number, upgraded: boolean, headers: Record<string, string>, error?: string }} WsOpenResult
 */

/**
 * Opens a live connection and reports every text message until close() is called.
 * @param {Target} target
 * @param {string} path
 * @param {{
 *   authorization?: string,
 *   timeoutMs?: number,
 *   keepAliveMs?: number,
 *   onMessage: (text: string) => void,
 *   onClose?: (reason: string) => void,
 * }} options
 * @returns {{ opened: Promise<WsOpenResult>, close: () => void }}
 */
export function listenWebSocket(target, path, { authorization, timeoutMs = 4000, keepAliveMs = 15_000, onMessage, onClose }) {
  assertReadOnlyWsPath(path);
  /** @type {import('node:net').Socket | undefined} */
  let socket;
  /** @type {NodeJS.Timeout | undefined} */
  let keepAlive;
  let closed = false;

  const finish = (/** @type {string} */ reason) => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    socket?.destroy();
    onClose?.(reason);
  };

  /** @type {Record<string, string>} */
  const headers = {
    Connection: 'Upgrade',
    Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
    'User-Agent': 'TSTV-Probe (read-only)',
  };
  if (authorization) headers.Authorization = authorization;

  const opened = new Promise((/** @type {(r: WsOpenResult) => void} */ resolve) => {
    const req = http.request({
      host: target.host,
      port: target.port,
      localAddress: target.localAddress,
      path,
      method: 'GET',
      headers,
      timeout: timeoutMs,
      agent: false,
    });
    req.on('upgrade', (res, sock, head) => {
      socket = sock;
      sock.setTimeout(0);
      resolve({ status: res.statusCode ?? 101, upgraded: true, headers: flatten(res.headers) });
      const reader = createFrameReader(sock, onMessage, finish);
      if (head.length) reader(head);
      sock.on('data', reader);
      sock.on('close', () => finish('connection closed'));
      sock.on('error', (err) => finish(err.message));
      keepAlive = setInterval(() => sendText(sock, WS_KEEPALIVE_MESSAGE), keepAliveMs);
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, upgraded: false, headers: flatten(res.headers) });
      finish(`not upgraded (HTTP ${res.statusCode})`);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'TIMEOUT' })));
    req.on('error', (/** @type {Error & { code?: string }} */ err) => {
      resolve({ status: 0, upgraded: false, headers: {}, error: err.code ?? err.message });
      finish(err.message);
    });
    req.end();
  });

  return { opened, close: () => finish('closed by probe') };
}

/**
 * @param {import('node:net').Socket} sock
 * @param {string} text
 */
function sendText(sock, text) {
  assertReadOnlyWsMessage(text);
  sock.write(encodeFrame(0x1, Buffer.from(text, 'utf8')));
}

/**
 * Client frames must be masked (RFC 6455, section 5.3).
 * @param {number} opcode
 * @param {Buffer} payload
 */
function encodeFrame(opcode, payload) {
  const mask = randomBytes(4);
  /** @type {Buffer} */
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/**
 * Returns a function that accepts raw bytes and calls onMessage for each complete text or binary message.
 * Answers pings with pongs and closes on a close frame; it never sends anything else.
 * @param {import('node:net').Socket} sock
 * @param {(text: string) => void} onMessage
 * @param {(reason: string) => void} finish
 */
function createFrameReader(sock, onMessage, finish) {
  let buffer = Buffer.alloc(0);
  /** @type {Buffer[]} */
  let fragments = [];
  return (/** @type {Buffer} */ chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskKey = masked ? buffer.subarray(offset, offset + 4) : undefined;
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      let payload = buffer.subarray(offset, offset + length);
      if (maskKey) payload = Buffer.from(payload.map((b, i) => b ^ maskKey[i % 4]));
      buffer = buffer.subarray(offset + length);

      if (opcode === 0x8) {
        sock.end(encodeFrame(0x8, Buffer.alloc(0)));
        finish('closed by TriCaster');
        return;
      }
      if (opcode === 0x9) {
        sock.write(encodeFrame(0xa, payload));
        continue;
      }
      if (opcode === 0xa) continue;
      fragments.push(payload);
      if (fin) {
        onMessage(Buffer.concat(fragments).toString('utf8'));
        fragments = [];
      }
    }
  };
}

/** @param {http.IncomingHttpHeaders} headers */
function flatten(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}
