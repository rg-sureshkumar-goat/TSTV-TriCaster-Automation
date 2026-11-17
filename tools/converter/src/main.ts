// Converts one rundown graphic on a GitHub machine (RG, Nov 17, 2026). The website starts this (see
// .github/workflows/convert-graphic.yml) with a job's id; this asks the website for the job (the file in
// Google Drive, its folder, and an hour's access to the Drive), downloads the file, checks it, converts
// it to 1080p, 29.97, ProRes 4444 with alpha in a .mov, sends the copy to the same folder, and tells the
// website, which puts the copy on the graphic in place of the original and deletes the original.
//
//   SITE_URL=https://… CONVERTER_SECRET=… node tools/converter/src/main.ts <job id>
//
// The workflow's log is public (the repository is), so nothing secret or about the file's contents is
// printed: just what's happening.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkGraphic, convertGraphic } from './format.ts';

export interface Job {
  fileName: string;
  driveFileId: string;
  folderId: string;
  accessToken: string;
}

export interface Site {
  url: string;
  secret: string;
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function website<T>(site: Site, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${site.url.replace(/\/+$/, '')}/api/converter/jobs/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Converter-Secret': site.secret, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `The website answered ${response.status}.`);
  return data;
}

async function download(job: Job, to: string, drive = DRIVE): Promise<void> {
  const response = await fetch(`${drive}/files/${encodeURIComponent(job.driveFileId)}?alt=media`, { headers: { Authorization: `Bearer ${job.accessToken}` } });
  if (!response.ok) throw new Error(`Google Drive answered ${response.status} to the download.`);
  await writeFile(to, Buffer.from(await response.arrayBuffer()));
}

async function upload(job: Job, file: string, name: string, upload = UPLOAD): Promise<string> {
  const bytes = await readFile(file);
  const start = await fetch(`${upload}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${job.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(bytes.length),
      'X-Upload-Content-Type': 'video/quicktime',
    },
    body: JSON.stringify({ name, parents: [job.folderId] }),
  });
  const location = start.headers.get('Location');
  if (!start.ok || !location) throw new Error(`Google Drive answered ${start.status} to the upload.`);
  const sent = await fetch(location, { method: 'PUT', headers: { 'Content-Type': 'video/quicktime' }, body: bytes });
  const data = (await sent.json().catch(() => ({}))) as { id?: string };
  if (!sent.ok || !data.id) throw new Error(`Google Drive answered ${sent.status} to the upload.`);
  return data.id;
}

/** The converted copy's name: the original's, as a .mov. */
export function convertedName(fileName: string): string {
  return `${fileName.replace(/\.[^.]+$/, '')}.mov`;
}

/** Runs one job from start to finish. Returns what happened, as the website was told. */
export async function runJob(site: Site, jobId: string, options: { drive?: string; upload?: string } = {}): Promise<'converted' | 'unchanged'> {
  const job = await website<Job>(site, encodeURIComponent(jobId));
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${job.accessToken}`);
  const folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-convert-'));
  try {
    const original = path.join(folder, `original${path.extname(job.fileName).toLowerCase()}`);
    console.log('Downloading the graphic from Google Drive…');
    await download(job, original, options.drive);
    console.log('Checking its format…');
    const problems = await checkGraphic(original);
    if (!problems.length) {
      console.log('It’s already in the right format.');
      await website(site, `${encodeURIComponent(jobId)}/done`, { unchanged: true });
      return 'unchanged';
    }
    console.log(`Converting: ${problems.map((p) => p.text).join('; ')}…`);
    const copy = path.join(folder, 'converted.mov');
    await convertGraphic(original, copy, problems);
    console.log('Sending the converted copy to Google Drive…');
    const driveFileId = await upload(job, copy, convertedName(job.fileName), options.upload);
    await website(site, `${encodeURIComponent(jobId)}/done`, { driveFileId, fixes: problems.map((p) => p.text) });
    console.log('Done: the converted copy is on the graphic.');
    return 'converted';
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`Couldn’t convert it: ${message}`);
    await website(site, `${encodeURIComponent(jobId)}/done`, { error: message }).catch(() => undefined);
    throw e;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const site = { url: process.env.SITE_URL ?? '', secret: process.env.CONVERTER_SECRET ?? '' };
  const jobId = process.argv[2] ?? '';
  if (!site.url || !site.secret || !jobId) {
    console.error('Needs SITE_URL, CONVERTER_SECRET and a job id.');
    process.exit(2);
  }
  runJob(site, jobId).then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
