// RiGster's show log (RG, Nov 17, 2026): a file per day, each line with the time to the millisecond.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logDay, logTime, ShowLog } from '../src/main/show-log.ts';

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-show-log-'));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('the show log', () => {
  it('writes each line, in order, with the time to the millisecond, in the day’s file', async () => {
    const log = new ShowLog(folder);
    log.write('Prompter: section a1');
    log.write('Sending: [{"kind":"dsk","on":true}]');
    await log.flushed();
    const lines = (await readFile(log.fileFor(), 'utf8')).trim().split('\n');
    expect(lines.map((l) => l.slice(14))).toEqual(['Prompter: section a1', 'Sending: [{"kind":"dsk","on":true}]']);
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}  /);
    expect(path.basename(log.fileFor())).toBe(`show-${logDay(new Date())}.log`);
  });

  it('writes a last line as RiGster closes, and nothing after it', async () => {
    const log = new ShowLog(folder);
    log.write('Before');
    await log.close();
    log.write('After');
    await log.flushed();
    const text = await readFile(log.fileFor(), 'utf8');
    expect(text).toContain('RiGster closed');
    expect(text).not.toContain('After');
  });

  it('deletes logs older than 30 days when RiGster opens', async () => {
    await writeFile(path.join(folder, 'show-2020-01-01.log'), 'old\n');
    const log = new ShowLog(folder);
    await new Promise((r) => setTimeout(r, 100));
    await log.flushed();
    expect(await readdir(folder)).not.toContain('show-2020-01-01.log');
  });

  it('formats times and days on this laptop’s clock', () => {
    const d = new Date(2026, 10, 17, 6, 5, 4, 3);
    expect(logTime(d)).toBe('06:05:04.003');
    expect(logDay(d)).toBe('2026-11-17');
  });
});
