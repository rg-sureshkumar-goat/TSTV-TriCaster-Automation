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

/**
 * Last-resort search of every self-assigned address (169.254.1.0 to 169.254.254.255) on the cable.
 * Any answer, even "refused", means a device is there.
 * @param {{
 *   localAddress: string,
 *   ports?: number[],
 *   concurrency?: number,
 *   timeoutMs?: number,
 *   onProgress?: (done: number, total: number) => void,
 *   shouldStop?: () => boolean,
 * }} options
 * Stops early once a port is open, since that's almost certainly the TC1.
 */
export async function sweepLinkLocal({ localAddress, ports = [80, 5951], concurrency = 384, timeoutMs = 400, onProgress, shouldStop }) {
  /** @type {{ host: string, port: number }[]} */
  const jobs = [];
  for (let third = 1; third <= 254; third++) {
    for (let fourth = 0; fourth <= 255; fourth++) {
      const host = `169.254.${third}.${fourth}`;
      if (host === localAddress) continue;
      for (const port of ports) jobs.push({ host, port });
    }
  }
  /** @type {Map<string, Record<string, PortState>>} */
  const found = new Map();
  let next = 0;
  let done = 0;
  let foundOpen = false;
  const started = Date.now();
  const worker = async () => {
    while (next < jobs.length && !foundOpen && !shouldStop?.()) {
      const job = jobs[next++];
      const state = await checkPort({ host: job.host, localAddress }, job.port, timeoutMs);
      if (state === 'open') foundOpen = true;
      if (state === 'open' || state === 'refused') {
        const entry = found.get(job.host) ?? {};
        entry[String(job.port)] = state;
        found.set(job.host, entry);
      }
      done++;
      if (done % Math.ceil(jobs.length / 10) === 0) onProgress?.(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return {
    checked: done,
    total: jobs.length,
    seconds: Math.round((Date.now() - started) / 1000),
    stoppedEarly: done < jobs.length,
    hosts: [...found.entries()].map(([host, portStates]) => ({ host, ports: portStates })),
  };
}
