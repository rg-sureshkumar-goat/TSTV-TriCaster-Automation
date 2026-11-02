// Show profiles (Nov 2, 2026): each show's permanent graphics, green screen and tease music, kept in the
// Google Drive the website is connected to, so every laptop with RiGster has them (RG: profiles are picked
// by hand, and shared online). This talks to the website (with the RiGster key) and to Google: it lists
// the profiles, sends a file into a show's folder, and downloads a profile's files onto the laptop, where
// RiGster keeps a copy so shows run even if the internet drops.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ShowSettings } from '@tstv/shared';

/** A file in a show's profile, as the website lists it. current: in the Drive that's connected now. */
export interface ProfileFile {
  driveFileId: string;
  fileName: string;
  size: number;
  md5: string | null;
  current: boolean;
}

export interface Profile {
  id: string;
  name: string;
  settings: ShowSettings;
  /** By slot: "greenScreen", "music" or "permanent:<name>". */
  files: Record<string, ProfileFile>;
}

export interface ProfileList {
  drive: { connected: boolean; email: string | null };
  profiles: Profile[];
}

export class ProfileError extends Error {}

type Progress = (done: number, total: number) => void;

export class ProfileSync {
  private token: { token: string; expiresAt: number } | null = null;

  constructor(
    private site: () => { siteUrl: string; key: string },
    /** Where downloaded files are kept on this laptop, a folder per show. */
    private folder: string,
    /** Google Drive's address (tests use a pretend one). */
    private driveApi = 'https://www.googleapis.com/drive/v3',
  ) {}

  private async website<T>(route: string, init: RequestInit = {}): Promise<T> {
    const { siteUrl, key } = this.site();
    if (!key) throw new ProfileError('Paste a RiGster key first: show profiles come from the website.');
    let response: Response;
    try {
      response = await fetch(`${siteUrl.replace(/\/+$/, '')}/api${route}`, {
        ...init,
        headers: { Authorization: `Bearer ${key}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProfileError('Can’t reach the website. Check the internet connection.');
    }
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new ProfileError(data.error ?? `The website answered ${response.status}.`);
    return data;
  }

  list(): Promise<ProfileList> {
    return this.website<ProfileList>('/app/profiles');
  }

  /** An hour's access to RiGster's files in the Drive, from the website. */
  private async access(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 5 * 60_000) return this.token.token;
    this.token = await this.website<{ token: string; expiresAt: number }>('/app/drive-token');
    return this.token.token;
  }

  /** Where a profile file is kept on this laptop. */
  localPath(showId: string, file: ProfileFile): string {
    return path.join(this.folder, showId, `${file.driveFileId}-${file.fileName.replace(/[\\/:*?"<>|]/g, '_')}`);
  }

  /** Downloads a profile file onto this laptop, unless it's already here. Returns where it is. */
  async download(showId: string, file: ProfileFile, progress: Progress = () => undefined): Promise<string> {
    const target = this.localPath(showId, file);
    const there = await stat(target).catch(() => null);
    if (there && there.size === file.size) return target;
    await mkdir(path.dirname(target), { recursive: true });
    const response = await fetch(`${this.driveApi}/files/${encodeURIComponent(file.driveFileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${await this.access()}` },
    }).catch(() => null);
    if (!response?.ok || !response.body) throw new ProfileError(`Couldn’t download ${file.fileName} from Google Drive${response ? ` (${response.status})` : ''}.`);
    // Written under another name first, so a half-downloaded file is never used.
    const partial = `${target}.part`;
    let done = 0;
    const count = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        done += chunk.length;
        progress(done, file.size);
        next(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body as never), count, createWriteStream(partial));
      if ((await stat(partial)).size !== file.size) throw new ProfileError(`${file.fileName} didn’t download completely.`);
      await rename(partial, target);
    } catch (e) {
      await rm(partial, { force: true });
      throw e instanceof ProfileError ? e : new ProfileError(`Couldn’t download ${file.fileName} from Google Drive.`);
    }
    return target;
  }

  /**
   * Sends a file from this laptop into a show's profile, in place of the one before. Returns the profile
   * file, which this laptop already has (its copy is kept under the profile file's name).
   */
  async upload(showId: string, slot: string, file: string, progress: Progress = () => undefined): Promise<ProfileFile> {
    const size = (await stat(file)).size;
    const fileName = path.basename(file);
    const { uploadUrl } = await this.website<{ uploadUrl: string }>(`/app/profiles/${encodeURIComponent(showId)}/uploads`, {
      method: 'POST',
      body: JSON.stringify({ slot, fileName, size, type: 'application/octet-stream' }),
    });
    const token = await this.access();
    const sent = await new Promise<{ id?: string }>((resolve, reject) => {
      const url = new URL(uploadUrl);
      const request = (url.protocol === 'http:' ? http : https).request(url, {
        method: 'PUT',
        headers: { 'Content-Length': String(size), 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
      });
      request.on('response', (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 300) return reject(new ProfileError(`Google Drive didn’t take ${fileName} (${response.statusCode}).`));
          try {
            resolve(JSON.parse(text) as { id?: string });
          } catch {
            reject(new ProfileError(`Google Drive didn’t say it got ${fileName}.`));
          }
        });
      });
      request.on('error', () => reject(new ProfileError(`Couldn’t send ${fileName} to Google Drive. Check the internet connection.`)));
      let done = 0;
      const stream = createReadStream(file);
      stream.on('data', (chunk) => {
        done += chunk.length;
        progress(done, size);
      });
      stream.on('error', () => reject(new ProfileError(`Couldn’t read ${fileName} on this laptop.`)));
      stream.pipe(request);
    });
    if (!sent.id) throw new ProfileError(`Google Drive didn’t say it got ${fileName}.`);
    const { file: saved } = await this.website<{ file: ProfileFile }>(`/app/profiles/${encodeURIComponent(showId)}/files`, {
      method: 'POST',
      body: JSON.stringify({ slot, driveFileId: sent.id }),
    });
    return saved;
  }

  /** Takes a file out of a show's profile. */
  async remove(showId: string, slot: string): Promise<void> {
    await this.website(`/app/profiles/${encodeURIComponent(showId)}/files/${encodeURIComponent(slot)}`, { method: 'DELETE' });
  }
}
