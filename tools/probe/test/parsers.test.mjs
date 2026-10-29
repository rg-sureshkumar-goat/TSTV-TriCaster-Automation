import { describe, expect, it } from 'vitest';
import {
  arpArgs,
  arpCandidates,
  bindAddressFor,
  describeAdapters,
  parseArp,
  parseHardwarePorts,
  parseIpv6Neighbors,
} from '../lib/network.mjs';
import { parseChunk } from '../lib/statePort.mjs';
import { buildQuery, ndiSources, parsePacket } from '../lib/mdns.mjs';
import { buildAuthorization } from '../lib/http.mjs';

const MAC_HARDWARE_PORTS = `
Hardware Port: Wi-Fi
Device: en0
Ethernet Address: aa:bb:cc:dd:ee:01

Hardware Port: USB 10/100/1000 LAN
Device: en7
Ethernet Address: aa:bb:cc:dd:ee:07

Hardware Port: Thunderbolt Bridge
Device: bridge0
Ethernet Address: N/A
`;

/** @returns {any} */
const iface = (address, family = 'IPv4', extra = {}) => ({
  address,
  netmask: family === 'IPv4' ? (address.startsWith('169.254.') ? '255.255.0.0' : '255.255.255.0') : 'ffff:ffff:ffff:ffff::',
  family,
  mac: 'aa:bb:cc:dd:ee:07',
  internal: false,
  cidr: null,
  ...(family === 'IPv6' ? { scopeid: 12 } : {}),
  ...extra,
});

describe('adapters', () => {
  it('finds the USB Ethernet adapter on a Mac and ignores Wi-Fi and virtual adapters', () => {
    const ports = parseHardwarePorts(MAC_HARDWARE_PORTS);
    expect(ports).toEqual({ en0: 'Wi-Fi', en7: 'USB 10/100/1000 LAN', bridge0: 'Thunderbolt Bridge' });
    const adapters = describeAdapters(
      {
        lo0: [iface('127.0.0.1', 'IPv4', { internal: true })],
        en0: [iface('10.145.3.20')],
        en7: [iface('169.254.33.10'), iface('fe80::1c:2b', 'IPv6')],
        bridge0: [],
        utun3: [iface('fe80::99', 'IPv6')],
      },
      ports,
    );
    const kinds = Object.fromEntries(adapters.map((a) => [a.name, a.kind]));
    expect(kinds).toEqual({ lo0: 'loopback', en0: 'wifi', en7: 'wired', bridge0: 'virtual', utun3: 'virtual' });
  });

  it('finds the Ethernet adapter on Windows', () => {
    const adapters = describeAdapters({
      'Wi-Fi': [iface('10.145.3.20')],
      'Ethernet 2': [iface('169.254.12.34')],
      'vEthernet (WSL)': [iface('172.20.0.1')],
    });
    expect(adapters.find((a) => a.kind === 'wired')?.name).toBe('Ethernet 2');
    expect(adapters.find((a) => a.name === 'vEthernet (WSL)')?.kind).toBe('virtual');
  });

  it('sends link-local traffic from the cable adapter address', () => {
    const wired = describeAdapters({ en7: [iface('169.254.33.10')] }, { en7: 'USB 10/100/1000 LAN' });
    expect(bindAddressFor('169.254.200.5', wired)?.localAddress).toBe('169.254.33.10');
    expect(bindAddressFor('192.168.1.10', wired)).toBeUndefined();
  });
});

describe('ARP tables', () => {
  it('reads the table as plain numbers on a Mac, so it never stalls looking up names when Wi-Fi is down', () => {
    expect(arpArgs('darwin')).toEqual(['-an']);
    expect(arpArgs('win32')).toEqual(['-a']);
  });

  it('reads the macOS format', () => {
    const text = [
      '? (10.145.3.1) at 0:11:22:33:44:55 on en0 ifscope [ethernet]',
      '? (169.254.200.5) at 0:1c:42:a:b:c on en7 [ethernet]',
      '? (169.254.255.255) at ff:ff:ff:ff:ff:ff on en7 [ethernet]',
      '? (169.254.9.9) at (incomplete) on en7 [ethernet]',
      '? (224.0.0.251) at 1:0:5e:0:0:fb on en7 ifscope permanent [ethernet]',
    ].join('\n');
    const entries = parseArp(text);
    expect(entries.map((e) => e.ip)).toEqual(['10.145.3.1', '169.254.200.5', '169.254.255.255', '224.0.0.251']);
    expect(entries[1].mac).toBe('00:1c:42:0a:0b:0c');
    const wired = describeAdapters({ en7: [iface('169.254.33.10')] }, { en7: 'USB 10/100/1000 LAN' });
    expect(arpCandidates(entries, wired).map((e) => e.ip)).toEqual(['169.254.200.5']);
  });

  it('reads the Windows format', () => {
    const text = [
      '',
      'Interface: 169.254.12.34 --- 0x12',
      '  Internet Address      Physical Address      Type',
      '  169.254.200.5         00-1c-42-0a-0b-0c     dynamic',
      '  169.254.255.255       ff-ff-ff-ff-ff-ff     static',
      '',
      'Interface: 10.145.3.20 --- 0x5',
      '  10.145.3.1            00-11-22-33-44-55     dynamic',
    ].join('\r\n');
    const entries = parseArp(text);
    expect(entries[0]).toEqual({ ip: '169.254.200.5', mac: '00:1c:42:0a:0b:0c', iface: '169.254.12.34', type: 'dynamic' });
    const wired = describeAdapters({ 'Ethernet 2': [iface('169.254.12.34')] });
    expect(arpCandidates(entries, wired).map((e) => e.ip)).toEqual(['169.254.200.5']);
  });
});

describe('IPv6 neighbors', () => {
  it('reads ndp on a Mac', () => {
    const text = [
      'Neighbor                        Linklayer Address  Netif Expire    St Flgs Prbs',
      'fe80::1c42:aff:fe0a:b0c%en7     0:1c:42:a:b:c      en7 23h59m58s S',
      'fe80::1%lo0                     (incomplete)       lo0 permanent R',
    ].join('\n');
    expect(parseIpv6Neighbors(text, 'darwin')).toEqual([{ ip: 'fe80::1c42:aff:fe0a:b0c', zone: 'en7', mac: '00:1c:42:0a:0b:0c' }]);
  });

  it('reads netsh on Windows', () => {
    const text = [
      'Interface 12: Ethernet 2',
      '',
      'Internet Address                              Physical Address   Type',
      '--------------------------------------------  -----------------  -----------',
      'fe80::1c42:aff:fe0a:b0c                       00-1c-42-0a-0b-0c  Reachable',
      'ff02::1                                       33-33-00-00-00-01  Permanent',
    ].join('\r\n');
    expect(parseIpv6Neighbors(text, 'win32')).toEqual([{ ip: 'fe80::1c42:aff:fe0a:b0c', zone: '12', mac: '00:1c:42:0a:0b:0c' }]);
  });
});

describe('state stream parsing', () => {
  it('handles tags split across network packets', () => {
    const seen = [];
    let rest = parseChunk('<build number="1" product="TriCaster" session="S" /><shortcut_states><shortcut_state name="ddr2_play" val', (s) => seen.push(s));
    expect(seen).toEqual([]);
    rest = parseChunk(`${rest}ue="1" type="bool" /><shortcut_state name="title" value="A &amp; B"></shortcut_state></shortcut_states>`, (s) => seen.push(s));
    expect(seen).toEqual([
      { name: 'ddr2_play', value: '1', type: 'bool' },
      { name: 'title', value: 'A & B', type: undefined },
    ]);
    expect(rest).toBe('</shortcut_states>');
  });

  it('reports build information', () => {
    const builds = [];
    parseChunk('<build number="210722" product="TC1" session="News" />', () => {}, (b) => builds.push(b));
    expect(builds[0]).toMatchObject({ number: '210722', product: 'TC1', session: 'News' });
  });
});

describe('multicast DNS', () => {
  it('builds a question and reads an answer with name compression', () => {
    const query = buildQuery(['_ndi._tcp.local']);
    expect(parsePacket(query)?.questions).toEqual(['_ndi._tcp.local']);

    // A response: PTR _ndi._tcp.local -> "TC1 (Program)._ndi._tcp.local", plus an A record.
    const header = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 2, 0, 0, 0, 0]);
    const name = Buffer.concat([Buffer.from([4]), Buffer.from('_ndi'), Buffer.from([4]), Buffer.from('_tcp'), Buffer.from([5]), Buffer.from('local'), Buffer.from([0])]);
    const instance = Buffer.concat([Buffer.from([13]), Buffer.from('TC1 (Program)'), Buffer.from([0xc0, 12])]);
    const ptr = Buffer.concat([name, Buffer.from([0, 12, 0, 1, 0, 0, 0, 120]), Buffer.from([0, instance.length]), instance]);
    const host = Buffer.concat([Buffer.from([3]), Buffer.from('tc1'), Buffer.from([0xc0, 22])]);
    const a = Buffer.concat([host, Buffer.from([0, 1, 0, 1, 0, 0, 0, 120, 0, 4, 169, 254, 200, 5])]);
    const parsed = parsePacket(Buffer.concat([header, ptr, a]));
    expect(parsed?.records).toEqual([
      { name: '_ndi._tcp.local', type: 'PTR', ttl: 120, data: 'TC1 (Program)._ndi._tcp.local' },
      { name: 'tc1.local', type: 'A', ttl: 120, data: '169.254.200.5' },
    ]);
  });

  it('ignores malformed packets', () => {
    expect(parsePacket(Buffer.from([1, 2, 3]))).toBeUndefined();
  });
});

describe('LivePanel password', () => {
  it('builds Basic and Digest answers', () => {
    const creds = { username: 'admin', password: 'secret' };
    expect(buildAuthorization('Basic realm="LivePanel"', creds, '/v1/version')?.header).toBe(`Basic ${Buffer.from('admin:secret').toString('base64')}`);
    const digest = buildAuthorization('Digest realm="TC", nonce="abc", qop="auth"', creds, '/v1/version');
    expect(digest?.scheme).toBe('Digest');
    expect(digest?.header).toMatch(/username="admin", realm="TC", nonce="abc", uri="\/v1\/version", response="[0-9a-f]{32}"/);
    expect(buildAuthorization('Negotiate', creds, '/')).toBeUndefined();
  });
});

describe('NDI video feeds', () => {
  it('lists the feeds announced on the cable, with their ports', () => {
    const packets = [
      {
        from: '169.254.193.52',
        port: 5353,
        via: 'en8',
        kind: /** @type {'answer'} */ ('answer'),
        questions: [],
        records: [
          { name: '_ndi._tcp.local', type: 'PTR', ttl: 120, data: 'TC1 (Mix 1)._ndi._tcp.local' },
          { name: '_ndi._tcp.local', type: 'PTR', ttl: 120, data: 'TC1 (Mix 2)._ndi._tcp.local' },
          { name: 'TC1 (Mix 1)._ndi._tcp.local', type: 'SRV', ttl: 120, data: { priority: 0, port: 5960, target: 'TC1.local' } },
          { name: '_services._dns-sd._udp.local', type: 'PTR', ttl: 120, data: '_ndi._tcp.local' },
        ],
      },
    ];
    expect(ndiSources(packets)).toEqual([
      { name: 'TC1 (Mix 1)', from: '169.254.193.52', port: 5960 },
      { name: 'TC1 (Mix 2)', from: '169.254.193.52', port: null },
    ]);
  });
});
