// How the Google Drive is laid out (RG, Nov 17, 2026), kept tidy by the website:
//
//   TSTV Rundowns
//   └── <show>
//       ├── Permanent        the show profile: permanent graphics, green screen, transitions, tease music
//       └── <air date> <episode title>   the graphics attached to that episode's rundown
//
// The top folder was called RiGster before (Nov 2, 2026), with the profile files straight in each show's
// folder. The first time the website uses the Drive after the change, it renames the top folder and moves
// each show's profile files into its Permanent folder (see tidy).
import { accessToken, makeFolder, move, rename } from './drive.ts';
import type { Env } from './env.ts';

export const ROOT_FOLDER = 'TSTV Rundowns';
export const PERMANENT_FOLDER = 'Permanent';

export interface DriveLink {
  email: string;
  refresh_token: string;
  root_folder_id: string;
  connected_at: number;
  layout: number;
}

export const driveLink = (env: Env) => env.DB.prepare('SELECT * FROM drive_link WHERE id = 1').first<DriveLink>();
export const googleClient = (env: Env) => ({ id: env.GOOGLE_CLIENT_ID ?? '', secret: env.GOOGLE_CLIENT_SECRET ?? '' });

/** An hour's access to the connected Drive, its details, and the layout brought up to date. */
export async function openDrive(env: Env): Promise<{ drive: DriveLink; token: string } | null> {
  const drive = await driveLink(env);
  if (!drive) return null;
  const { token } = await accessToken(drive.refresh_token, googleClient(env));
  if (drive.layout < 1) await tidy(env, token, drive);
  return { drive, token };
}

/** Renames the top folder TSTV Rundowns, and moves each show's profile files into its Permanent folder. */
async function tidy(env: Env, token: string, drive: DriveLink): Promise<void> {
  await rename(token, drive.root_folder_id, ROOT_FOLDER);
  const { results: shows } = await env.DB.prepare('SELECT show_id FROM show_drive_folders WHERE email = ?').bind(drive.email).all<{ show_id: string }>();
  for (const { show_id } of shows) await permanentFolder(env, token, drive, show_id);
  await env.DB.prepare('UPDATE drive_link SET layout = 1 WHERE id = 1').run();
  drive.layout = 1;
}

/** The show's folder in the Drive, made the first time it's needed. */
export async function showFolder(env: Env, token: string, drive: DriveLink, show: { id: string; name: string }): Promise<string> {
  const known = await env.DB.prepare('SELECT folder_id FROM show_drive_folders WHERE show_id = ? AND email = ?').bind(show.id, drive.email).first<{ folder_id: string }>();
  if (known) return known.folder_id;
  const id = await makeFolder(token, show.name, drive.root_folder_id);
  await env.DB.prepare('INSERT OR REPLACE INTO show_drive_folders (show_id, email, folder_id) VALUES (?, ?, ?)').bind(show.id, drive.email, id).run();
  return id;
}

/**
 * The show's Permanent folder, where its profile's files go. Made the first time it's needed, and the
 * profile files already in the show's folder (from before Nov 17, 2026) are moved into it.
 */
export async function permanentFolder(env: Env, token: string, drive: DriveLink, show: { id: string; name?: string } | string): Promise<string> {
  const showId = typeof show === 'string' ? show : show.id;
  const row = await env.DB.prepare('SELECT folder_id, permanent_folder_id FROM show_drive_folders WHERE show_id = ? AND email = ?')
    .bind(showId, drive.email)
    .first<{ folder_id: string; permanent_folder_id: string | null }>();
  if (row?.permanent_folder_id) return row.permanent_folder_id;
  const name = typeof show === 'string' ? ((await env.DB.prepare('SELECT name FROM shows WHERE id = ?').bind(showId).first<{ name: string }>())?.name ?? showId) : (show.name ?? showId);
  const parent = row?.folder_id ?? (await showFolder(env, token, drive, { id: showId, name }));
  const permanent = await makeFolder(token, PERMANENT_FOLDER, parent);
  const { results: files } = await env.DB.prepare('SELECT drive_file_id FROM show_profile_files WHERE show_id = ? AND email = ?').bind(showId, drive.email).all<{ drive_file_id: string }>();
  for (const f of files) await move(token, f.drive_file_id, parent, permanent).catch(() => undefined);
  await env.DB.prepare('UPDATE show_drive_folders SET permanent_folder_id = ? WHERE show_id = ? AND email = ?').bind(permanent, showId, drive.email).run();
  return permanent;
}

/** An episode's folder's name: its air date, then its title, so the folders sort by date. */
export function episodeFolderName(episode: { title: string; air_date?: string | null }): string {
  const title = String(episode.title).replace(/[\\/]/g, '-').trim() || 'Untitled episode';
  return episode.air_date ? `${episode.air_date} ${title}` : title;
}

/** The episode's folder, inside its show's folder, made the first time a graphic is attached. */
export async function episodeFolder(env: Env, token: string, drive: DriveLink, episodeId: string): Promise<string> {
  const known = await env.DB.prepare('SELECT folder_id FROM episode_drive_folders WHERE episode_id = ? AND email = ?').bind(episodeId, drive.email).first<{ folder_id: string }>();
  if (known) return known.folder_id;
  const episode = await env.DB.prepare('SELECT e.id, e.title, e.air_date, s.id AS show_id, s.name AS show_name FROM episodes e JOIN shows s ON s.id = e.show_id WHERE e.id = ?')
    .bind(episodeId)
    .first<{ id: string; title: string; air_date: string | null; show_id: string; show_name: string }>();
  if (!episode) throw new Error('That episode doesn’t exist any more.');
  const parent = await showFolder(env, token, drive, { id: episode.show_id, name: episode.show_name });
  const id = await makeFolder(token, episodeFolderName(episode), parent);
  await env.DB.prepare('INSERT OR REPLACE INTO episode_drive_folders (episode_id, email, folder_id, created_at) VALUES (?, ?, ?, ?)').bind(episodeId, drive.email, id, Date.now()).run();
  return id;
}
