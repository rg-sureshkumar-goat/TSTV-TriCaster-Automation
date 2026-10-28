// @ts-check
// Listens to the TriCaster's state stream on TCP port 5951, the same stream node-tricaster uses.
// The probe sends only the "register for updates" message and empty keep-alive lines.
import net from 'node:net';
import { assertReadOnlyStatePortMessage, KEEPALIVE_MESSAGE, REGISTER_MESSAGE } from './guard.mjs';

/**
 * @typedef {import('./http.mjs').Target} Target
 * @typedef {{ name: string, value: string, type?: string }} StateEntry
 * @typedef {{ number?: string, product?: string, session?: string, raw: string }} BuildInfo
 */

const MAX_RAW_CHARS = 3_000_000;

/**
 * @param {Target} target host plus the state port
 * @param {{
 *   timeoutMs?: number,
 *   keepAliveMs?: number,
 *   onState: (entry: StateEntry) => void,
 *   onBuild?: (info: BuildInfo) => void,
 *   onClose?: (reason: string) => void,
 * }} options
 */
export function listenStatePort(target, { timeoutMs = 4000, keepAliveMs = 5000, onState, onBuild, onClose }) {
  let raw = '';
  let rawChars = 0;
  let pending = '';
  let closed = false;
  /** @type {NodeJS.Timeout | undefined} */
  let keepAlive;

  const socket = net.connect({ host: target.host, port: target.port, localAddress: target.localAddress });
  socket.setTimeout(timeoutMs);

  const send = (/** @type {string} */ message) => {
    assertReadOnlyStatePortMessage(message);
    socket.write(message);
  };

  const finish = (/** @type {string} */ reason) => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    socket.destroy();
    onClose?.(reason);
  };

  const opened = new Promise((/** @type {(r: { connected: boolean, error?: string }) => void} */ resolve) => {
    socket.once('connect', () => {
      socket.setTimeout(0);
      send(REGISTER_MESSAGE);
      keepAlive = setInterval(() => send(KEEPALIVE_MESSAGE), keepAliveMs);
      resolve({ connected: true });
    });
    socket.once('timeout', () => {
      resolve({ connected: false, error: 'TIMEOUT' });
      finish('timed out');
    });
    socket.once('error', (/** @type {Error & { code?: string }} */ err) => {
      resolve({ connected: false, error: err.code ?? err.message });
      finish(err.message);
    });
  });

  socket.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (rawChars < MAX_RAW_CHARS) raw += text.slice(0, MAX_RAW_CHARS - rawChars);
    rawChars += text.length;
    pending = parseChunk(pending + text, onState, onBuild);
  });
  socket.on('close', () => finish('connection closed'));

  return {
    opened,
    close: () => finish('closed by probe'),
    raw: () => ({ text: raw, totalChars: rawChars, truncated: rawChars > MAX_RAW_CHARS }),
  };
}

const TAG = /<(shortcut_state|build)\b([^>]*?)\/?>/g;

/**
 * Pulls every complete <shortcut_state …> and <build …> tag out of the text and returns what's left over.
 * Handles both self-closing tags and tags with a separate closing tag.
 * @param {string} text
 * @param {(entry: StateEntry) => void} onState
 * @param {((info: BuildInfo) => void) | undefined} onBuild
 */
export function parseChunk(text, onState, onBuild) {
  let lastEnd = 0;
  for (const match of text.matchAll(TAG)) {
    const attrs = parseAttributes(match[2]);
    if (match[1] === 'build') {
      onBuild?.({ number: attrs.number, product: attrs.product, session: attrs.session, raw: match[0] });
    } else if (attrs.name !== undefined) {
      onState({ name: attrs.name, value: attrs.value ?? '', type: attrs.type });
    }
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  const rest = text.slice(lastEnd);
  const openTag = rest.lastIndexOf('<');
  // Keep only a possibly incomplete trailing tag, and never let leftovers grow without limit.
  return openTag >= 0 && rest.length - openTag < 10_000 ? rest.slice(openTag) : '';
}

/** @param {string} source */
export function parseAttributes(source) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const match of source.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

/** @param {string} value */
export function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}
