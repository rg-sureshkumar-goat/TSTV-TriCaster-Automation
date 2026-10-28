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
  { port: 5960, why: 'NDI video (first source)' },
  { port: 5961, why: 'NDI video' },
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
