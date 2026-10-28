// @ts-check
// Finds the TC1 on the cable without changing any network settings.
import net from 'node:net';
import { arpCandidates, bindAddressFor, isLinkLocalV4, parseArp, parseIpv6Neighbors, runCommand } from './network.mjs';
import { queryMdns, querySsdp } from './mdns.mjs';
import { checkPorts, sweepLinkLocal } from './ports.mjs';
import { readOnlyGet } from './http.mjs';

/**
 * @typedef {import('./network.mjs').Adapter} Adapter
 * @typedef {{
 *   host: string, family: 4 | 6, localAddress?: string, adapter?: string,
 *   sources: string[], names: string[], quickPorts?: Record<string, string>,
 *   version?: { status: number, product?: string, error?: string }, score?: number
 * }} Candidate
 */

/**
 * @param {{
 *   wired: Adapter[],
 *   platform: string,
 *   httpPort: number,
 *   statePort: number,
 *   sweep: boolean,
 *   log: (line: string) => void,
 *   signal?: AbortSignal,
 * }} options
 */
export async function discover({ wired, platform, httpPort, statePort, sweep, log, signal }) {
  /** @type {Map<string, Candidate>} */
  const candidates = new Map();
  /** @type {Map<string, Set<string>>} */
  const offSubnet = new Map();
  const add = (/** @type {string} */ host, /** @type {string} */ source, /** @type {string[]} */ names = []) => {
    const isV6 = host.includes(':');
    const binding = isV6 ? undefined : bindAddressFor(host, wired);
    if (!isV6 && !binding) {
      // Seen on the cable but outside its address range: the TC1 may have a fixed address.
      const seen = offSubnet.get(host) ?? new Set();
      seen.add(source);
      offSubnet.set(host, seen);
      return;
    }
    const existing = candidates.get(host) ?? {
      host,
      family: isV6 ? 6 : 4,
      localAddress: binding?.localAddress,
      adapter: binding?.adapter.name,
      sources: [],
      names: [],
    };
    if (!existing.sources.includes(source)) existing.sources.push(source);
    for (const name of names) if (!existing.names.includes(name)) existing.names.push(name);
    candidates.set(host, /** @type {Candidate} */ (existing));
  };

  log('Reading the laptop\'s table of devices it has already seen on the cable...');
  const arpBefore = await runCommand('arp', ['-a']);
  for (const entry of arpCandidates(parseArp(arpBefore.stdout), wired)) add(entry.ip, 'ARP table');

  log('Asking the cable "who\'s there?" (multicast DNS and UPnP)...');
  const withV4 = wired.filter((a) => a.ipv4.length > 0);
  const [mdnsLists, ssdpLists] = await Promise.all([
    Promise.all(withV4.map((a) => queryMdns({ localAddress: a.ipv4[0].address, adapterName: a.name }))),
    Promise.all(withV4.map((a) => querySsdp({ localAddress: a.ipv4[0].address, adapterName: a.name }))),
  ]);
  const mdns = mdnsLists.flat();
  const ssdp = ssdpLists.flat();
  for (const packet of mdns) {
    const names = packet.records
      .flatMap((r) => [r.type === 'PTR' ? String(r.data) : '', r.type === 'SRV' ? String(/** @type {any} */ (r.data).target) : '', r.type === 'A' ? r.name : ''])
      .filter((n) => n && !n.startsWith('_services.'));
    add(packet.from, packet.kind === 'answer' ? 'mDNS answer' : 'mDNS announcement', names);
    for (const r of packet.records) if (r.type === 'A' && typeof r.data === 'string') add(r.data, `mDNS record for ${r.name}`, [r.name]);
  }
  for (const reply of ssdp) add(reply.from, 'UPnP answer', [reply.headers.server ?? ''].filter(Boolean));

  const arpAfter = await runCommand('arp', ['-a']);
  for (const entry of arpCandidates(parseArp(arpAfter.stdout), wired)) add(entry.ip, 'ARP table');

  log('Looking for IPv6 neighbors on the cable...');
  const ipv6 = await findIpv6Neighbors(wired, platform);
  for (const n of ipv6.neighbors) add(`${n.ip}%${n.zone}`, 'IPv6 neighbor');

  if (signal?.aborted) return finish();

  log(`Checking ${candidates.size} possible device(s) for TriCaster control ports...`);
  for (const c of candidates.values()) log(`  ${c.host} (${c.sources.join(', ')})`);
  await Promise.all([...candidates.values()].map((c) => identify(c, httpPort, statePort)));

  /** @type {(Awaited<ReturnType<typeof sweepLinkLocal>> & { adapter: string })[]} */
  const sweeps = [];
  // Most likely adapter first (describeAdapters sorts them); stop as soon as something answers.
  for (const adapter of wired) {
    const own = adapter.ipv4.find((x) => isLinkLocalV4(x.address));
    if (!own || bestOf(candidates) || !sweep || signal?.aborted) continue;
    log(`Nothing answered yet, so searching every automatic address on ${adapter.name}${adapter.label ? ` (${adapter.label})` : ''}. This can take up to 2 minutes...`);
    const result = await sweepLinkLocal({
      localAddress: own.address,
      ports: [httpPort, statePort],
      onProgress: (done, total) => log(`  searched ${Math.round((done / total) * 100)}%`),
      shouldStop: () => Boolean(signal?.aborted),
    });
    sweeps.push({ ...result, adapter: adapter.name });
    for (const host of result.hosts) add(host.host, 'cable search');
    await Promise.all([...candidates.values()].filter((c) => !c.quickPorts).map((c) => identify(c, httpPort, statePort)));
  }

  return finish();

  function finish() {
    const chosen = bestOf(candidates);
    return {
      wiredAdapters: wired.map((a) => a.name),
      arp: { before: arpBefore, after: arpAfter },
      mdns,
      ssdp,
      ipv6,
      sweeps,
      candidates: [...candidates.values()],
      offSubnet: [...offSubnet.entries()].map(([ip, sources]) => ({
        ip,
        sources: [...sources],
        note: 'Seen on the cable but outside the laptop\'s automatic address range. If this is the TC1, it has a fixed address.',
      })),
      chosen,
    };
  }
}

/**
 * Checks the control ports and asks for /v1/version, then scores how TriCaster-like the device looks.
 * @param {Candidate} candidate
 * @param {number} httpPort
 * @param {number} statePort
 */
async function identify(candidate, httpPort, statePort) {
  const target = { host: candidate.host, localAddress: candidate.localAddress };
  candidate.quickPorts = await checkPorts(target, [httpPort, statePort], 1500);
  let score = Object.values(candidate.quickPorts).some((s) => s === 'refused') ? 10 : 0;
  if (candidate.quickPorts[String(httpPort)] === 'open') {
    score = Math.max(score, 40);
    const version = await readOnlyGet({ ...target, port: httpPort }, '/v1/version', { timeoutMs: 3000, maxBytes: 200_000 });
    const product = version.body.match(/<product_name>([^<]*)<\/product_name>|product_name="([^"]*)"/);
    candidate.version = { status: version.status, product: product?.[1] ?? product?.[2], error: version.error };
    if (version.status === 200 && /product/i.test(version.body)) score = 100;
    else if (version.status === 401) score = 80;
  }
  if (candidate.quickPorts[String(statePort)] === 'open') score = Math.max(score, 60);
  candidate.score = score;
}

/** @param {Map<string, Candidate>} candidates */
function bestOf(candidates) {
  const ranked = [...candidates.values()].filter((c) => (c.score ?? 0) >= 40).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return ranked[0];
}

/**
 * Every device has an IPv6 address on a cable even when IPv4 addresses don't match, so this is
 * a fallback route to a TC1 that has a fixed IPv4 address.
 * @param {Adapter[]} wired
 * @param {string} platform
 */
async function findIpv6Neighbors(wired, platform) {
  /** @type {import('./network.mjs').CommandResult[]} */
  const pings = [];
  const zones = new Map();
  for (const adapter of wired) {
    const own = adapter.ipv6.find((a) => /^fe80:/i.test(a.address));
    if (!own) continue;
    const zone = platform === 'win32' ? String(own.scopeid ?? '') : adapter.name;
    if (!zone) continue;
    zones.set(zone, adapter.name);
    pings.push(
      platform === 'win32'
        ? await runCommand('ping', ['-n', '2', '-w', '1000', `ff02::1%${zone}`], 6000)
        : await runCommand('ping6', ['-c', '2', '-I', adapter.name, 'ff02::1'], 6000),
    );
  }
  const table =
    platform === 'win32'
      ? await runCommand('netsh', ['interface', 'ipv6', 'show', 'neighbors'])
      : await runCommand('ndp', ['-an']);
  const ownAddresses = new Set(wired.flatMap((a) => a.ipv6.map((x) => x.address.toLowerCase().split('%')[0])));
  const ownMacs = new Set(wired.map((a) => a.mac));
  const neighbors = parseIpv6Neighbors(table.stdout, platform).filter(
    (n) => zones.has(n.zone) && !ownAddresses.has(n.ip) && !ownMacs.has(n.mac) && !n.mac.startsWith('33:33'),
  );
  return { pings, table, neighbors };
}

/**
 * Used when RG types an address: works out how to reach it.
 * @param {string} host
 * @param {Adapter[]} wired
 */
export function explicitCandidate(host, wired) {
  const binding = net.isIPv4(host) ? bindAddressFor(host, wired) : undefined;
  /** @type {Candidate} */
  const candidate = {
    host,
    family: host.includes(':') ? 6 : 4,
    localAddress: binding?.localAddress,
    adapter: binding?.adapter.name,
    sources: ['typed in'],
    names: [],
  };
  return candidate;
}

