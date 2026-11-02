// Show profiles (RG, Nov 2, 2026): two laptops share a show's permanent graphics, green screen and music
// through Google Drive. A pretend website and Google Drive stand in for the real ones.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_SHOW_SETTINGS } from '@tstv/shared';
import { Runtime } from '../src/main/runtime.ts';
import { Store } from '../src/main/store.ts';

const KEY = 'tstv-abcdefghijklmnopqrstuvwxyz';
let folder: string;
let server: Server;
let site: string;
/** What the pretend Drive holds, by file id, and each show's profile, by slot. */
const drive = new Map<string, { name: string; bytes: Buffer }>();
const profiles: Record<string, Record<string, { driveFileId: string; fileName: string; size: number; md5: null; current: boolean }>> = { show1: {}, show2: {} };
/** Which show the RiGster key's episode belongs to. */
let keyShow = 'show1';

const show = (id: string, name: string) => ({ id, name, settings: { ...DEFAULT_SHOW_SETTINGS } });

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-profiles-'));
  let next = 1;
  const uploads = new Map<string, string>();
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.headers.authorization !== `Bearer ${KEY}` && url.pathname.startsWith('/api/')) return json(401, { error: 'Bad key' });
      if (url.pathname === '/api/app/episode') {
        return json(200, { episode: { id: 'ep1', title: 'Episode', airDate: '', airTime: '' }, show: show(keyShow, keyShow === 'show1' ? 'PrimeTime' : 'Sports') });
      }
      if (url.pathname === '/api/app/profiles') {
        return json(200, { drive: { connected: true, email: 'rg@example.com' }, profiles: [{ ...show('show1', 'PrimeTime'), files: profiles.show1 }, { ...show('show2', 'Sports'), files: profiles.show2 }] });
      }
      if (url.pathname === '/api/app/drive-token') return json(200, { token: 'drive-token', expiresAt: Date.now() + 3_600_000 });
      const m = /^\/api\/app\/profiles\/([^/]+)\/(uploads|files)(?:\/(.+))?$/.exec(url.pathname);
      if (m && m[2] === 'uploads') {
        const id = `upload-${next++}`;
        uploads.set(id, JSON.parse(body.toString()).fileName);
        return json(200, { uploadUrl: `${site}/upload/${id}` });
      }
      if (m && m[2] === 'files' && req.method === 'POST') {
        const { slot, driveFileId } = JSON.parse(body.toString());
        const file = drive.get(driveFileId)!;
        profiles[m[1]][slot] = { driveFileId, fileName: file.name, size: file.bytes.length, md5: null, current: true };
        return json(200, { file: profiles[m[1]][slot] });
      }
      if (m && m[2] === 'files' && req.method === 'DELETE') {
        delete profiles[m[1]][decodeURIComponent(m[3])];
        return json(200, { ok: true });
      }
      if (url.pathname.startsWith('/upload/') && req.method === 'PUT') {
        if (req.headers.authorization !== 'Bearer drive-token') return json(401, {});
        const id = `drive-${next++}`;
        drive.set(id, { name: uploads.get(url.pathname.slice('/upload/'.length))!, bytes: body });
        return json(200, { id });
      }
      const file = /^\/drive\/v3\/files\/(.+)$/.exec(url.pathname);
      if (file && req.headers.authorization === 'Bearer drive-token') {
        const found = drive.get(decodeURIComponent(file[1]));
        if (!found) return json(404, {});
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return res.end(found.bytes);
      }
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  server?.close();
  await rm(folder, { recursive: true, force: true });
});

const waitFor = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** A laptop with RiGster, its own memory, and the RiGster key pasted. */
async function laptop(name: string): Promise<Runtime> {
  const store = new Store(path.join(folder, name));
  await store.saveSettings({ ...(await store.settings()), siteUrl: site, key: KEY, simulatorAddress: '127.0.0.1:1' });
  const runtime = new Runtime({ store, pickFiles: async () => [], pickFile: async () => null, driveApi: `${site}/drive/v3` });
  await runtime.start();
  return runtime;
}

const idle = (r: Runtime) => r.state().profileSync.checked && !r.state().profileSync.working;

describe('show profiles shared through Google Drive', () => {
  let a: Runtime;
  let b: Runtime;

  it('picks the RiGster key’s show’s profile on a new laptop, and lists every show', async () => {
    a = await laptop('laptop-a');
    await waitFor(() => idle(a));
    expect(a.state().profile).toEqual({ id: 'show1', name: 'PrimeTime' });
    expect(a.state().profiles.map((p) => p.name)).toEqual(['PrimeTime', 'Sports']);
    expect(a.state().profileMismatch).toBe(false);
    // RiGster opens on the Select A Show Profile page every time, until a show is picked there.
    expect(a.state().profilePicked).toBe(false);
    await a.act({ kind: 'setProfile', showId: 'show1' });
    expect(a.state().profilePicked).toBe(true);
    expect(a.state().profile?.id).toBe('show1');
  });

  it('sends a green screen dropped on one laptop to Google Drive, and the other laptop gets it', async () => {
    const background = path.join(folder, 'Studio background.png');
    await writeFile(background, 'pretend picture');
    await a.act({ kind: 'setGreenScreen', path: background });
    await waitFor(() => profiles.show1.greenScreen !== undefined && idle(a));
    expect(profiles.show1.greenScreen.fileName).toBe('Studio background.png');

    b = await laptop('laptop-b');
    await waitFor(() => b.state().greenScreen !== null && idle(b));
    expect(b.state().greenScreen?.file).toMatch(/Studio background\.png$/);
    const copy = (await import('node:fs')).readdirSync(path.join(folder, 'laptop-b', 'profiles', 'show1'));
    expect(await readFile(path.join(folder, 'laptop-b', 'profiles', 'show1', copy[0]), 'utf8')).toBe('pretend picture');
  });

  it('takes a file removed on one laptop off the other too', async () => {
    await a.act({ kind: 'clearGreenScreen' });
    await waitFor(() => profiles.show1.greenScreen === undefined);
    await (b as unknown as { refreshProfiles(): Promise<void> }).refreshProfiles();
    expect(b.state().greenScreen).toBeNull();
  });

  it('won’t follow a RiGster key for another show’s episode, and says so', async () => {
    keyShow = 'show2';
    await a.act({ kind: 'connect', siteUrl: site, key: KEY });
    expect(a.state().profileMismatch).toBe(true);
    expect(a.state().episode).toBeNull();
    // Picking that show's profile follows it again.
    await a.act({ kind: 'setProfile', showId: 'show2' });
    expect(a.state().profileMismatch).toBe(false);
    expect(a.state().profile?.name).toBe('Sports');
    expect(a.state().episode?.title).toBe('Episode');
    a.close();
    b.close();
  });
});
