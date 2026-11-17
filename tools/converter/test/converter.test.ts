// The graphic converter that runs on GitHub's machines (RG, Nov 17, 2026), against a pretend website and
// Google Drive, converting real files with FFmpeg.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { clearOutsideBlack } from '../src/format.ts';
import { convertedName, runJob } from '../src/main.ts';

const run = promisify(execFile);
const ffmpeg = ffmpegStatic as unknown as string;
process.env.FFMPEG = ffmpeg;
let folder: string;
let server: Server;
let site: string;
const SECRET = 'converter-secret';
/** The pretend Drive's files, and what the website was told when each job finished. */
const drive = new Map<string, Buffer>();
const jobs: Record<string, { fileName: string; driveFileId: string }> = {};
const results: Record<string, unknown> = {};

// A white bar with a black box in it (like black text), over a solid black background.
const bar = 'drawbox=x=100:y=500:w=600:h=120:color=white:t=fill,drawbox=x=300:y=530:w=100:h=60:color=black:t=fill';

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-converter-'));
  const make = (name: string, args: string[]) => run(ffmpeg, ['-v', 'error', '-y', ...args, path.join(folder, name)]);
  await make('wrong.mp4', ['-f', 'lavfi', '-i', `color=c=black:s=1280x720:d=1:r=60000/1001,${bar}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  await make('right.mov', ['-f', 'lavfi', '-i', `color=c=black@0:s=1920x1080:d=1:r=30000/1001,format=rgba,${bar}`, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le']);
  drive.set('wrong', await readFile(path.join(folder, 'wrong.mp4')));
  drive.set('right', await readFile(path.join(folder, 'right.mov')));
  jobs['job-1'] = { fileName: 'A1_L3_Score.mp4', driveFileId: 'wrong' };
  jobs['job-2'] = { fileName: 'A2_L3_Good.mov', driveFileId: 'right' };
  let next = 1;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(data));
      };
      const job = /^\/api\/converter\/jobs\/([^/]+)(\/done)?$/.exec(url.pathname);
      if (job) {
        if (req.headers['x-converter-secret'] !== SECRET) return json(401, { error: 'Wrong secret' });
        if (job[2]) {
          results[job[1]] = JSON.parse(body.toString());
          return json(200, { ok: true });
        }
        return json(200, { ...jobs[job[1]], folderId: 'episode-folder', accessToken: 'drive-token' });
      }
      if (req.headers.authorization !== 'Bearer drive-token' && !url.pathname.startsWith('/session/')) return json(401, {});
      const file = /^\/drive\/files\/(.+)$/.exec(url.pathname);
      if (file) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return res.end(drive.get(decodeURIComponent(file[1])));
      }
      if (url.pathname === '/upload/files') return json(200, {}, { Location: `${site}/session/${next++}` });
      if (url.pathname.startsWith('/session/')) {
        const id = `converted-${next++}`;
        drive.set(id, body);
        return json(200, { id });
      }
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  server?.close();
  await rm(folder, { recursive: true, force: true });
});

/** How see-through one spot of a clip is, half a second in: 0 clear to 255 solid. */
async function alphaAt(file: string, x: number, y: number): Promise<number> {
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-vf', `format=rgba,alphaextract,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer' });
  return (stdout as unknown as Buffer)[0];
}

describe('the graphic converter on GitHub’s machines', () => {
  const options = () => ({ drive: `${site}/drive`, upload: `${site}/upload` });

  it('converts a graphic in the wrong format, sends the copy back, and tells the website', async () => {
    expect(await runJob({ url: site, secret: SECRET }, 'job-1', options())).toBe('converted');
    const told = results['job-1'] as { driveFileId: string; fixes: string[] };
    expect(told.fixes).toContain('it’s H264, not ProRes 4444');
    expect(told.fixes).toContain('it has no see-through parts (the black around the graphic is made see-through)');
    const copy = path.join(folder, 'copy.mov');
    await writeFile(copy, drive.get(told.driveFileId)!);
    const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', copy]).catch((e: { stderr: string }) => e);
    expect(stderr).toMatch(/prores \(4444\)[^\n]*yuva444p\w*[^\n]*1920x1080[^\n]*29\.97 fps/);
    // The black around the bar is see-through; the bar, and the black box inside it, stay solid.
    expect(await alphaAt(copy, 200, 200)).toBe(0);
    expect(await alphaAt(copy, 200, 780)).toBe(255);
    expect(await alphaAt(copy, 525, 840)).toBe(255);
  }, 120_000);

  it('leaves a graphic already in the right format as it is', async () => {
    expect(await runJob({ url: site, secret: SECRET }, 'job-2', options())).toBe('unchanged');
    expect(results['job-2']).toEqual({ unchanged: true });
  }, 60_000);

  it('names the copy after the original, as a .mov', () => {
    expect(convertedName('A1_L3_Score.mp4')).toBe('A1_L3_Score.mov');
    expect(convertedName('A1_L3_Score.mov')).toBe('A1_L3_Score.mov');
  });

  it('clears black joined to the edges and keeps black inside', () => {
    const w = 5;
    const h = 5;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) px[i * 4 + 3] = 255;
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) px.fill(255, (y * w + x) * 4, (y * w + x) * 4 + 3);
    px.fill(0, (2 * w + 2) * 4, (2 * w + 2) * 4 + 3);
    clearOutsideBlack(px, w, h);
    expect(px[3]).toBe(0);
    expect(px[(2 * w + 2) * 4 + 3]).toBe(255);
  });
});
