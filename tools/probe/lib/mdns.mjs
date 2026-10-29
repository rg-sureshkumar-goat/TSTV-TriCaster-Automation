// @ts-check
// Finds devices on the cable by asking "who's there?" the way Macs and NDI devices find each other
// (multicast DNS), and by listening for the announcements Windows machines make on their own.
// These are questions on the network only; nothing is sent to the TriCaster's control interfaces.
import dgram from 'node:dgram';

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;
const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

export const MDNS_SERVICE_QUESTIONS = Object.freeze([
  '_services._dns-sd._udp.local',
  '_ndi._tcp.local',
  '_http._tcp.local',
  '_smb._tcp.local',
  '_workstation._tcp.local',
  '_device-info._tcp.local',
]);

/**
 * @typedef {{ name: string, type: string, ttl: number, data: string | number | string[] | Record<string, unknown> }} DnsRecord
 * @typedef {{ from: string, port: number, via: string, kind: 'answer' | 'heard', records: DnsRecord[], questions: string[] }} MdnsPacket
 * @typedef {{ from: string, via: string, headers: Record<string, string> }} SsdpReply
 */

/**
 * Builds a DNS question packet asking for PTR records.
 * @param {readonly string[]} names
 */
export function buildQuery(names) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(names.length, 4);
  const questions = names.map((name) => {
    const labels = name.split('.').map((label) => {
      const bytes = Buffer.from(label, 'utf8');
      return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    });
    const tail = Buffer.alloc(5);
    tail.writeUInt16BE(12, 1); // PTR
    tail.writeUInt16BE(0x8001, 3); // class IN, "unicast reply preferred"
    return Buffer.concat([...labels, tail]);
  });
  return Buffer.concat([header, ...questions]);
}

const TYPE_NAMES = /** @type {Record<number, string>} */ ({ 1: 'A', 12: 'PTR', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 47: 'NSEC' });

/**
 * Parses a DNS packet into its questions and records. Returns undefined for anything malformed.
 * @param {Buffer} packet
 */
export function parsePacket(packet) {
  try {
    const qd = packet.readUInt16BE(4);
    const counts = packet.readUInt16BE(6) + packet.readUInt16BE(8) + packet.readUInt16BE(10);
    let offset = 12;
    /** @type {string[]} */
    const questions = [];
    for (let i = 0; i < qd; i++) {
      const [name, next] = readName(packet, offset);
      questions.push(name);
      offset = next + 4;
    }
    /** @type {DnsRecord[]} */
    const records = [];
    for (let i = 0; i < counts; i++) {
      const [name, next] = readName(packet, offset);
      const type = packet.readUInt16BE(next);
      const ttl = packet.readUInt32BE(next + 4);
      const length = packet.readUInt16BE(next + 8);
      const start = next + 10;
      records.push({ name, type: TYPE_NAMES[type] ?? String(type), ttl, data: readData(packet, type, start, length) });
      offset = start + length;
    }
    return { questions, records };
  } catch {
    return undefined;
  }
}

/**
 * @param {Buffer} packet
 * @param {number} type
 * @param {number} start
 * @param {number} length
 */
function readData(packet, type, start, length) {
  if (type === 1 && length === 4) return [...packet.subarray(start, start + 4)].join('.');
  if (type === 28 && length === 16) {
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(packet.readUInt16BE(start + i).toString(16));
    return parts.join(':');
  }
  if (type === 12) return readName(packet, start)[0];
  if (type === 33) return { priority: packet.readUInt16BE(start), port: packet.readUInt16BE(start + 4), target: readName(packet, start + 6)[0] };
  if (type === 16) {
    const strings = [];
    let i = start;
    while (i < start + length) {
      const len = packet[i];
      strings.push(packet.subarray(i + 1, i + 1 + len).toString('utf8'));
      i += len + 1;
    }
    return strings;
  }
  return packet.subarray(start, start + length).toString('hex');
}

/**
 * Reads a possibly compressed DNS name. Returns the name and the offset just after it.
 * @param {Buffer} packet
 * @param {number} offset
 * @returns {[string, number]}
 */
function readName(packet, offset) {
  const labels = [];
  let end = -1;
  let jumps = 0;
  for (;;) {
    const len = packet[offset];
    if (len === undefined) throw new Error('truncated name');
    if (len === 0) {
      offset += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = offset + 2;
      offset = ((len & 0x3f) << 8) | packet[offset + 1];
      if (++jumps > 20) throw new Error('name loop');
      continue;
    }
    labels.push(packet.subarray(offset + 1, offset + 1 + len).toString('utf8'));
    offset += len + 1;
  }
  return [labels.join('.'), end >= 0 ? end : offset];
}

/**
 * Asks "what services are here?" on one adapter, and listens for anything else devices announce.
 * @param {{ localAddress: string, adapterName: string, durationMs?: number, questions?: readonly string[] }} options
 * @returns {Promise<MdnsPacket[]>}
 */
export async function queryMdns({ localAddress, adapterName, durationMs = 4000, questions = MDNS_SERVICE_QUESTIONS }) {
  /** @type {MdnsPacket[]} */
  const packets = [];
  const query = buildQuery(questions);

  const asker = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const listener = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const record = (/** @type {Buffer} */ msg, /** @type {dgram.RemoteInfo} */ rinfo, /** @type {'answer' | 'heard'} */ kind) => {
    if (rinfo.address === localAddress) return;
    const parsed = parsePacket(msg);
    if (parsed) packets.push({ from: rinfo.address, port: rinfo.port, via: adapterName, kind, ...parsed });
  };
  asker.on('message', (msg, rinfo) => record(msg, rinfo, 'answer'));
  listener.on('message', (msg, rinfo) => record(msg, rinfo, 'heard'));
  asker.on('error', () => {});
  listener.on('error', () => {});

  await bind(asker, { address: localAddress, port: 0 }).catch(() => {});
  try {
    asker.setMulticastInterface(localAddress);
    asker.send(query, MDNS_PORT, MDNS_ADDRESS);
  } catch {
    // An adapter without a usable address can't send; the passive listener may still hear things.
  }
  // Passive listening shares port 5353 with the system's own service; it's best-effort.
  await bind(listener, { port: MDNS_PORT, exclusive: false })
    .then(() => listener.addMembership(MDNS_ADDRESS, localAddress))
    .catch(() => {});

  await delay(durationMs / 2);
  try {
    asker.send(query, MDNS_PORT, MDNS_ADDRESS);
  } catch {}
  await delay(durationMs / 2);
  asker.close();
  listener.close();
  return packets;
}

/**
 * Asks UPnP devices to identify themselves (SSDP M-SEARCH). Windows machines often answer.
 * @param {{ localAddress: string, adapterName: string, durationMs?: number }} options
 * @returns {Promise<SsdpReply[]>}
 */
export async function querySsdp({ localAddress, adapterName, durationMs = 3000 }) {
  /** @type {SsdpReply[]} */
  const replies = [];
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', () => {});
  socket.on('message', (msg, rinfo) => {
    /** @type {Record<string, string>} */
    const headers = {};
    for (const line of msg.toString('utf8').split(/\r?\n/).slice(1)) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    replies.push({ from: rinfo.address, via: adapterName, headers });
  });
  const search = Buffer.from(
    ['M-SEARCH * HTTP/1.1', `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`, 'MAN: "ssdp:discover"', 'MX: 2', 'ST: ssdp:all', '', ''].join('\r\n'),
  );
  try {
    await bind(socket, { address: localAddress, port: 0 });
    socket.setMulticastInterface(localAddress);
    socket.send(search, SSDP_PORT, SSDP_ADDRESS);
  } catch {
    socket.close();
    return replies;
  }
  await delay(durationMs);
  socket.close();
  return replies;
}

/**
 * @param {dgram.Socket} socket
 * @param {dgram.BindOptions} options
 */
function bind(socket, options) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(options, () => {
      socket.off('error', reject);
      resolve(undefined);
    });
  });
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The NDI video feeds devices on the cable announce, like "TC1 (Mix 1)" (Phase 4: to learn whether the
 * show app can show the cameras' video). Asking is a question on the network only, like the rest of this
 * file; it never opens a feed.
 * @param {MdnsPacket[]} packets
 * @returns {{ name: string, from: string, port: number | null }[]}
 */
export function ndiSources(packets) {
  /** @type {Map<string, { name: string, from: string, port: number | null }>} */
  const found = new Map();
  for (const packet of packets) {
    for (const r of packet.records) {
      const instance = r.type === 'PTR' && /_ndi\._tcp\.local$/i.test(r.name) ? String(r.data) : r.type === 'SRV' && /_ndi\._tcp\.local$/i.test(r.name) ? r.name : null;
      if (!instance || /^_ndi\._tcp\.local$/i.test(instance)) continue;
      const name = instance.replace(/\._ndi\._tcp\.local$/i, '');
      const entry = found.get(name) ?? { name, from: packet.from, port: null };
      if (r.type === 'SRV' && typeof r.data === 'object' && r.data && 'port' in r.data) entry.port = Number(r.data.port);
      found.set(name, entry);
    }
  }
  return [...found.values()];
}
