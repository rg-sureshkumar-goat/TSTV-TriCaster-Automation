// Google Drive for RiGster's show profiles (Nov 2, 2026). The website holds the connection to one Drive
// (an admin connects it), with permission only to the files RiGster puts there ("drive.file"). It keeps
// a RiGster folder with a folder per show, starts uploads, and gives RiGster short-lived access, so the
// files themselves go straight between RiGster and Google, never through the website.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  md5: string | null;
  parents: string[];
  trashed: boolean;
}

export class DriveError extends Error {}

/** Access to the Drive for an hour, from the connection's refresh token. Cached until shortly before it ends. */
const cached = new Map<string, { token: string; until: number }>();

export async function accessToken(
  refreshToken: string,
  client: { id: string; secret: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ token: string; expiresAt: number }> {
  const hit = cached.get(refreshToken);
  if (hit && hit.until > Date.now() + 5 * 60_000) return { token: hit.token, expiresAt: hit.until };
  const response = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token) {
    throw new DriveError(data.error === 'invalid_grant' ? 'The Google Drive connection has ended. An admin needs to connect it again.' : 'Google Drive didn’t answer.');
  }
  const until = Date.now() + (data.expires_in ?? 3600) * 1000;
  cached.set(refreshToken, { token: data.access_token, until });
  return { token: data.access_token, expiresAt: until };
}

async function drive<T>(token: string, url: string, init: RequestInit, fetchFn: typeof fetch): Promise<T> {
  const response = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new DriveError(`Google Drive answered ${response.status}.`);
  return (response.status === 204 ? {} : await response.json()) as T;
}

/** Makes a folder, inside parent (or at the top of the Drive). Returns its id. */
export async function makeFolder(token: string, name: string, parent: string | null, fetchFn: typeof fetch = fetch): Promise<string> {
  const body = { name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) };
  const made = await drive<{ id: string }>(token, `${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetchFn);
  return made.id;
}

/**
 * Starts an upload of a file into folder. Returns the address RiGster sends the file to (Google's
 * "resumable upload"), which answers with the new file's id when it's all there.
 */
export async function startUpload(
  token: string,
  folder: string,
  file: { name: string; size: number; type: string },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchFn(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size,md5Checksum`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(file.size),
      'X-Upload-Content-Type': file.type,
    },
    body: JSON.stringify({ name: file.name, parents: [folder] }),
  });
  const location = response.headers.get('Location');
  if (!response.ok || !location) throw new DriveError(`Google Drive answered ${response.status}.`);
  return location;
}

export async function fileInfo(token: string, id: string, fetchFn: typeof fetch = fetch): Promise<DriveFile | null> {
  try {
    const f = await drive<{ id: string; name: string; size?: string; md5Checksum?: string; parents?: string[]; trashed?: boolean }>(
      token,
      `${API}/files/${encodeURIComponent(id)}?fields=id,name,size,md5Checksum,parents,trashed`,
      { method: 'GET' },
      fetchFn,
    );
    return { id: f.id, name: f.name, size: Number(f.size ?? 0), md5: f.md5Checksum ?? null, parents: f.parents ?? [], trashed: f.trashed === true };
  } catch {
    return null;
  }
}

/** Moves a file to the Drive's trash (it can still be brought back from there for 30 days). */
export async function trash(token: string, id: string, fetchFn: typeof fetch = fetch): Promise<void> {
  await drive(token, `${API}/files/${encodeURIComponent(id)}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }, fetchFn).catch(() => undefined);
}

/**
 * A show's profile slots: its green screen, its tease music, its two transitions (between back-to-back
 * teases, and in and out of a LITES; RG, Nov 2, 2026), and each of its permanent graphics.
 */
export function isSlot(slot: string, permanentGraphics: string[]): boolean {
  if (slot === 'greenScreen' || slot === 'music' || slot === 'transition:tease' || slot === 'transition:lites') return true;
  return slot.startsWith('permanent:') && permanentGraphics.includes(slot.slice('permanent:'.length));
}
