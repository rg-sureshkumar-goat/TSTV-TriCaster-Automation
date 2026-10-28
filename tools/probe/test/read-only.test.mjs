// The probe must never be able to send a command to the TC1. These tests fail the build if it could.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertReadOnlyHttp,
  assertReadOnlyStatePortMessage,
  assertReadOnlyWsMessage,
  assertReadOnlyWsPath,
  KEEPALIVE_MESSAGE,
  ReadOnlyViolation,
  REGISTER_MESSAGE,
  WS_KEEPALIVE_MESSAGE,
} from '../lib/guard.mjs';

const PROBE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function probeSourceFiles() {
  const files = [path.join(PROBE_DIR, 'probe.mjs')];
  for (const name of fs.readdirSync(path.join(PROBE_DIR, 'lib'))) files.push(path.join(PROBE_DIR, 'lib', name));
  return files;
}

describe('probe source code', () => {
  it.each([
    ['the command address', /\/v1\/shortcut/],
    ['an XML command', /<shortcut[\s>]/],
    ['a macro trigger', /play_macro/],
    ['a POST request', /POST/],
    ['a PUT request', /\bPUT\b/],
    ['a DELETE request', /\bDELETE\b/],
  ])('never contains %s', (_label, pattern) => {
    for (const file of probeSourceFiles()) {
      expect(fs.readFileSync(file, 'utf8'), path.basename(file)).not.toMatch(pattern);
    }
  });

  it('only sends network data through the guard', () => {
    for (const file of probeSourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      // Writing to the terminal (process.stdout) is fine; writing to a network connection is not.
      const writes = source.match(/(?<!process\.stdout)\.(write|send)\(/g) ?? [];
      if (writes.length === 0) continue;
      // Each file that writes to a socket must import its guard check.
      const name = path.basename(file);
      if (name === 'mdns.mjs') continue; // discovery questions go to multicast addresses, not the TC1's control ports
      expect(source, name).toMatch(/assertReadOnly/);
    }
  });
});

describe('read-only guard', () => {
  it.each(['/', '/v1/', '/v1/version', '/v1/datalink', '/v1/dictionary?key=tally', '/v1/dictionary?key=shortcut_states'])('allows GET %s', (p) => {
    expect(() => assertReadOnlyHttp('GET', p)).not.toThrow();
  });

  it.each([
    ['POST', '/v1/version'],
    ['PUT', '/v1/version'],
    ['GET', '/v1/shortcut?name=main_dsk2_take'],
    ['GET', '/v1/shortcut'],
    ['GET', '/v1/../v1/shortcut?name=record_toggle'],
    ['GET', '/v1/trigger'],
    ['GET', '/v1/dictionary?key=tally&name=main_take'],
    ['GET', '/v1/dictionary?key=../shortcut'],
    ['GET', '/v1/dictionary'],
    ['GET', '/v1/version?name=x'],
  ])('blocks %s %s', (method, p) => {
    expect(() => assertReadOnlyHttp(method, p)).toThrow(ReadOnlyViolation);
  });

  it('allows only the register and keep-alive messages on the state port', () => {
    expect(() => assertReadOnlyStatePortMessage(REGISTER_MESSAGE)).not.toThrow();
    expect(() => assertReadOnlyStatePortMessage(KEEPALIVE_MESSAGE)).not.toThrow();
    expect(() => assertReadOnlyStatePortMessage('<shortcut name="main_dsk2_take" />\n')).toThrow(ReadOnlyViolation);
    expect(() => assertReadOnlyStatePortMessage('<register name="NTK_states"/>\n<shortcut name="x"/>')).toThrow(ReadOnlyViolation);
  });

  it('allows only the keep-alive text on the change-notification connection', () => {
    expect(() => assertReadOnlyWsMessage(WS_KEEPALIVE_MESSAGE)).not.toThrow();
    expect(() => assertReadOnlyWsMessage('main_dsk2_take')).toThrow(ReadOnlyViolation);
    expect(() => assertReadOnlyWsPath('/v1/change_notifications')).not.toThrow();
    expect(() => assertReadOnlyWsPath('/v1/shortcut')).toThrow(ReadOnlyViolation);
  });
});
