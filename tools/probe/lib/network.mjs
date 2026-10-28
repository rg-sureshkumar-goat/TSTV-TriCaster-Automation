// @ts-check
// Facts about the laptop's own network: adapters, which one is the cable, and the address tables
// the operating system already keeps. Everything here only reads.
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';

/**
 * @typedef {{ command: string, code: number | null, stdout: string, stderr: string, error?: string }} CommandResult
 * @typedef {{ address: string, netmask: string, mac: string, cidr?: string | null, scopeid?: number }} Address
 * @typedef {{
 *   name: string, label?: string, kind: 'wired' | 'wifi' | 'virtual' | 'loopback' | 'unknown',
 *   reasons: string[], ipv4: Address[], ipv6: Address[], mac?: string, confidence: number
 * }} Adapter
 * @typedef {{ ip: string, mac: string, iface: string, type?: string }} ArpEntry
 */

/**
 * Runs a read-only system command (arp, netstat, networksetup...) and never throws.
 * @param {string} command
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<CommandResult>}
 */
export function runCommand(command, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4_000_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
      resolve({
        command: [command, ...args].join(' '),
        code,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        ...(err && code === null ? { error: String(err.code ?? err.message) } : {}),
      });
    });
  });
}

/**
 * Mac only: maps device names like "en7" to hardware port names like "USB 10/100/1000 LAN".
 * @param {string} text output of `networksetup -listallhardwareports`
 */
export function parseHardwarePorts(text) {
  /** @type {Record<string, string>} */
  const ports = {};
  let port = '';
  for (const line of text.split(/\r?\n/)) {
    const portMatch = line.match(/^Hardware Port:\s*(.+)$/);
    if (portMatch) port = portMatch[1].trim();
    const deviceMatch = line.match(/^Device:\s*(\S+)/);
    if (deviceMatch && port) ports[deviceMatch[1]] = port;
  }
  return ports;
}

const VIRTUAL_NAME = /^(lo\d*|utun|awdl|llw|bridge|gif|stf|anpi|ap\d|vmnet|vboxnet|docker|veth|tailscale|zt|tun|tap)/i;
const VIRTUAL_LABEL = /vEthernet|VirtualBox|VMware|Hyper-V|Loopback|Bluetooth|Tailscale|ZeroTier|WSL|Npcap|Thunderbolt Bridge|iPhone USB|VPN/i;
const WIFI = /wi-?fi|wlan|wireless|airport|802\.11/i;
const WIRED = /ethernet|\blan\b|usb|^eth\d|^en\d+$/i;

/**
 * Lists every adapter and decides which ones could be the TC1 cable.
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [interfaces]
 * @param {Record<string, string>} [hardwarePorts]
 * @returns {Adapter[]}
 */
export function describeAdapters(interfaces = os.networkInterfaces(), hardwarePorts = {}) {
  /** @type {Adapter[]} */
  const adapters = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos) continue;
    const label = hardwarePorts[name];
    const text = `${name} ${label ?? ''}`;
    const ipv4 = infos.filter((i) => i.family === 'IPv4').map(toAddress);
    const ipv6 = infos.filter((i) => i.family === 'IPv6').map(toAddress);
    /** @type {string[]} */
    const reasons = [];
    /** @type {Adapter['kind']} */
    let kind = 'unknown';
    if (infos.some((i) => i.internal)) {
      kind = 'loopback';
      reasons.push('internal loopback');
    } else if (VIRTUAL_NAME.test(name) || VIRTUAL_LABEL.test(text)) {
      kind = 'virtual';
      reasons.push('virtual or VPN adapter');
    } else if (WIFI.test(text)) {
      kind = 'wifi';
      reasons.push('named Wi-Fi');
    } else if (label ? WIRED.test(label) : WIRED.test(name) && name !== 'en0') {
      kind = 'wired';
      reasons.push(label ? `hardware port "${label}"` : `adapter name "${name}"`);
    }
    if (kind === 'unknown' && ipv4.some((a) => isLinkLocalV4(a.address))) {
      kind = 'wired';
      reasons.push('has a self-assigned 169.254 address, typical of a direct cable');
    }
    const mac = infos[0]?.mac;
    // How likely this is the TC1 cable, so the most likely adapter gets searched first.
    let confidence = 0;
    if (kind === 'wired') {
      confidence = 1;
      if (label && WIRED.test(label)) confidence += 2;
      if (ipv4.some((a) => isLinkLocalV4(a.address))) confidence += 1;
      if (mac && isLocallyAdministered(mac)) {
        confidence -= 1;
        reasons.push('its hardware address looks virtual (often a tethered phone or a display)');
      }
    }
    adapters.push({ name, label, kind, reasons, ipv4, ipv6, mac, confidence });
  }
  return adapters.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Real network adapters have factory hardware addresses. Locally administered ones (second bit of the
 * first byte set) usually belong to virtual or tethered devices.
 * @param {string} mac
 */
export function isLocallyAdministered(mac) {
  const first = parseInt(mac.split(':')[0] ?? '0', 16);
  return mac !== '00:00:00:00:00:00' && (first & 0x02) !== 0;
}

/** @param {os.NetworkInterfaceInfo} info */
function toAddress(info) {
  /** @type {Address} */
  const address = { address: info.address, netmask: info.netmask, mac: info.mac, cidr: info.cidr };
  if (info.family === 'IPv6') address.scopeid = info.scopeid;
  return address;
}

/** @param {string} ip */
export function isLinkLocalV4(ip) {
  return ip.startsWith('169.254.');
}

/** @param {string} ip */
export function isLinkLocalV6(ip) {
  return /^fe80:/i.test(ip);
}

/** @param {string} ip */
function v4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

/**
 * True when ip is on the same subnet as the adapter address.
 * @param {string} ip
 * @param {Address} adapterAddress
 */
export function sameSubnetV4(ip, adapterAddress) {
  if (!net.isIPv4(ip) || !net.isIPv4(adapterAddress.address)) return false;
  const mask = v4ToInt(adapterAddress.netmask);
  return (v4ToInt(ip) & mask) === (v4ToInt(adapterAddress.address) & mask);
}

/**
 * The laptop address to send from when talking to ip over a wired adapter. Sending from the cable's own
 * address makes a Mac use the cable even when Wi-Fi also has a self-assigned address.
 * @param {string} ip
 * @param {Adapter[]} wired
 */
export function bindAddressFor(ip, wired) {
  for (const adapter of wired) {
    for (const address of adapter.ipv4) {
      if (sameSubnetV4(ip, address)) return { adapter, localAddress: address.address };
    }
  }
  return undefined;
}

/**
 * Arguments for reading the ARP table. On a Mac, plain `arp -a` looks up a name for every address,
 * which stalls when Wi-Fi is down; `-n` keeps it to numbers. Windows always prints numbers.
 * @param {string} platform
 */
export function arpArgs(platform) {
  return platform === 'win32' ? ['-a'] : ['-an'];
}

/**
 * Parses `arp -a` from macOS or Windows.
 * @param {string} text
 * @returns {ArpEntry[]}
 */
export function parseArp(text) {
  /** @type {ArpEntry[]} */
  const entries = [];
  let windowsIface = '';
  for (const line of text.split(/\r?\n/)) {
    const ifaceMatch = line.match(/^Interface:\s*([\d.]+)/);
    if (ifaceMatch) {
      windowsIface = ifaceMatch[1];
      continue;
    }
    const mac = line.match(/\(([\d.]+)\) at ([0-9a-f:]+|\(incomplete\)) on (\S+)/i);
    if (mac) {
      if (mac[2] === '(incomplete)') continue;
      entries.push({ ip: mac[1], mac: normalizeMac(mac[2]), iface: mac[3], type: line.includes('permanent') ? 'permanent' : 'dynamic' });
      continue;
    }
    const win = line.match(/^\s+([\d.]+)\s+([0-9a-f-]{17})\s+(\w+)/i);
    if (win && windowsIface) entries.push({ ip: win[1], mac: normalizeMac(win[2]), iface: windowsIface, type: win[3].toLowerCase() });
  }
  return entries;
}

/** @param {string} mac */
function normalizeMac(mac) {
  return mac
    .split(/[:-]/)
    .map((part) => part.padStart(2, '0').toLowerCase())
    .join(':');
}

/**
 * Keeps ARP entries that could be a real device on one of the wired adapters.
 * @param {ArpEntry[]} entries
 * @param {Adapter[]} wired
 */
export function arpCandidates(entries, wired) {
  const own = new Set(wired.flatMap((a) => a.ipv4.map((x) => x.address)));
  return entries.filter((entry) => {
    if (own.has(entry.ip)) return false;
    if (entry.mac === 'ff:ff:ff:ff:ff:ff' || entry.mac.startsWith('01:00:5e')) return false;
    const first = Number(entry.ip.split('.')[0]);
    if (first >= 224) return false;
    if (entry.ip.endsWith('.255')) return false;
    return wired.some((a) => a.name === entry.iface || a.ipv4.some((x) => x.address === entry.iface || sameSubnetV4(entry.ip, x)));
  });
}

/**
 * Parses IPv6 neighbor tables: `ndp -an` (Mac) or `netsh interface ipv6 show neighbors` (Windows).
 * Returns link-local neighbors with the zone needed to reach them.
 * @param {string} text
 * @param {'darwin' | 'win32' | string} platform
 */
export function parseIpv6Neighbors(text, platform) {
  /** @type {{ ip: string, zone: string, mac: string }[]} */
  const neighbors = [];
  let zone = '';
  for (const line of text.split(/\r?\n/)) {
    if (platform === 'win32') {
      const header = line.match(/^Interface\s+(\d+):/i);
      if (header) zone = header[1];
      const row = line.match(/^\s*(fe80::[0-9a-f:]+)\s+([0-9a-f-]{17})\s+/i);
      if (row && zone && !/^33-33/.test(row[2])) neighbors.push({ ip: row[1].toLowerCase(), zone, mac: normalizeMac(row[2]) });
    } else {
      const row = line.match(/^(fe80::[0-9a-f:]+)%(\S+)\s+([0-9a-f:]+)\s+(\S+)/i);
      if (row && row[3] !== '(incomplete)') neighbors.push({ ip: row[1].toLowerCase(), zone: row[2], mac: normalizeMac(row[3]) });
    }
  }
  return neighbors;
}
