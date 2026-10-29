// @ts-check
// Checks which network ports answer. A check opens a connection and closes it straight away,
// without sending anything, so it can't change anything on the TriCaster.
import net from 'node:net';

/**
 * Ports worth knowing about on a TriCaster running Windows.
 * @type {ReadonlyArray<{ port: number, why: string }>}
 */
export const TRICASTER_PORTS = Object.freeze([
  { port: 80, why: 'Web control (LivePanel and the /v1 API)' },
  { port: 443, why: 'Secure web control' },
  { port: 5951, why: 'State stream used by node-tricaster' },
  { port: 5952, why: 'Possible second control port' },
  { port: 5960, why: 'NDI: the list of its video feeds' },
  { port: 5961, why: 'NDI video' },
  { port: 5962, why: 'NDI video' },
  { port: 5963, why: 'NDI video' },
  { port: 5964, why: 'NDI video' },
  { port: 5965, why: 'NDI video' },
  { port: 5966, why: 'NDI video' },
  { port: 5967, why: 'NDI video' },
  { port: 5968, why: 'NDI video' },
  { port: 445, why: 'Windows file sharing (copying media to the TC1)' },
  { port: 139, why: 'Older Windows file sharing' },
  { port: 3389, why: 'Windows Remote Desktop' },
  { port: 5900, why: 'Screen sharing (VNC)' },
  { port: 8080, why: 'Alternate web port' },
]);

/**
 * @typedef {'open' | 'refused' | 'timeout' | string} PortState
 * @typedef {{ host: string, localAddress?: string }} PortTarget
 */

/**
 * @param {PortTarget} target
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<PortState>}
 */
export function checkPort(target, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: target.host, port, localAddress: target.localAddress });
    const done = (/** @type {PortState} */ state) => {
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done('open'));
    socket.once('timeout', () => done('timeout'));
    socket.once('error', (/** @type {Error & { code?: string }} */ err) => done(err.code === 'ECONNREFUSED' ? 'refused' : err.code ?? 'error'));
  });
}

/**
 * @param {PortTarget} target
 * @param {readonly number[]} ports
 * @param {number} [timeoutMs]
 */
export async function checkPorts(target, ports, timeoutMs) {
  const states = await Promise.all(ports.map((port) => checkPort(target, port, timeoutMs)));
  /** @type {Record<string, PortState>} */
  const result = {};
  ports.forEach((port, i) => (result[String(port)] = states[i]));
  return result;
}

/**
 * The NDI video feeds a device lists on port 5960. An NDI device sends this list to anyone who connects,
 * without being asked, so the probe connects, listens for two seconds and sends nothing. (Added Oct 29,
 * 2026: the TC1 lists its feeds here even when it doesn't answer the network's "who's there?" question.)
 * @param {PortTarget} target
 * @param {number} [timeoutMs]
 * @returns {Promise<{ name: string, port: number }[] | null>}
 */
export function readNdiList(target, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let text = '';
    const socket = net.connect({ host: target.host, port: 5960, localAddress: target.localAddress });
    const finish = () => {
      socket.destroy();
      resolve(text ? parseNdiList(text) : null);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, finish);
    socket.on('data', (chunk) => {
      text += chunk;
      if (text.length > 64_000 || /<\/ndi>/.test(text)) finish();
    });
    socket.on('error', () => resolve(null));
    socket.on('close', finish);
  });
}

/**
 * @param {string} xml
 * @returns {{ name: string, port: number }[]}
 */
export function parseNdiList(xml) {
  return [...xml.matchAll(/<service\b[^>]*\bname="([^"]*)"[^>]*\bport="(\d+)"/g)].map((m) => ({ name: m[1].replace(/&amp;/g, '&'), port: Number(m[2]) }));
}
