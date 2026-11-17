// The graphics attached to a rundown (RG, Nov 17, 2026). Each item in a section's Graphics column has a
// Choose Graphic button: the browser sends the file straight to Google Drive, into the episode's folder
// (see drive-layout.ts), and the website remembers which file goes with which item. RiGster, with the
// episode's RiGster key, gets the list and downloads each file onto its cue. The episode's folder is
// deleted for good two weeks after its air date (deleteAiredGraphics, run every morning).
import type { Hono } from 'hono';
import { graphicsDeleteDate, isAttachable, type AttachedGraphic } from '@tstv/shared';
import { deleteForever, DriveError, fileInfo, shareByLink, startUpload } from './drive.ts';
import { episodeFolder, openDrive } from './drive-layout.ts';
import type { Env, User } from './env.ts';

type App = Hono<{ Bindings: Env; Variables: { user: User } }>;
type VisibleEpisode = (env: Env, user: User, id: string) => Promise<Record<string, unknown> | null>;

/** What kind of file it is, from its name, so the browser knows how to play it. */
export function mediaType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const types: Record<string, string> = { mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff', gif: 'image/gif' };
  return types[ext] ?? 'application/octet-stream';
}

const NO_DRIVE = 'No Google Drive is connected yet. An admin connects one on the website’s Usage page.';

function graphicJson(r: Record<string, unknown>): AttachedGraphic {
  return {
    elementId: String(r.element_id),
    driveFileId: String(r.drive_file_id),
    fileName: String(r.file_name),
    size: Number(r.size),
    md5: (r.md5 as string | null) ?? null,
    uploadedBy: (r.uploaded_by_name as string | null) ?? null,
    uploadedAt: Number(r.uploaded_at),
  };
}

async function attached(env: Env, episodeId: string): Promise<AttachedGraphic[]> {
  const { results } = await env.DB.prepare(
    `SELECT g.*, u.name AS uploaded_by_name FROM episode_graphics g LEFT JOIN users u ON u.id = g.uploaded_by WHERE g.episode_id = ? ORDER BY g.uploaded_at`,
  )
    .bind(episodeId)
    .all<Record<string, unknown>>();
  return results.map(graphicJson);
}

/**
 * Whether an id looks like a rundown item's. The rundown itself lives in the episode's room, not the
 * database, so the browser says which type the item is when it starts sending (music and permanent
 * graphics are refused); only the signed-in crew can send anything.
 */
const validElementId = (id: string) => /^[A-Za-z0-9_-]{1,80}$/.test(id);

export function registerGraphicsRoutes(app: App, visibleEpisode: VisibleEpisode): void {
  /** The files attached to an episode's rundown, and when its folder is deleted. */
  app.get('/episodes/:id/graphics', async (c) => {
    const episode = await visibleEpisode(c.env, c.get('user'), c.req.param('id'));
    if (!episode) return c.json({ error: 'Episode not found.' }, 404);
    const drive = await c.env.DB.prepare('SELECT email FROM drive_link WHERE id = 1').first<{ email: string }>();
    const folder = await c.env.DB.prepare('SELECT folder_id FROM episode_drive_folders WHERE episode_id = ?').bind(episode.id).first<{ folder_id: string }>();
    return c.json({
      driveConnected: drive !== null,
      deleteOn: graphicsDeleteDate(episode.air_date as string | null),
      deletedAt: (episode.graphics_deleted_at as number | null) ?? null,
      // The folder itself is in the admin's Drive, so only admins get its link.
      folderUrl: c.get('user').isAdmin && folder ? `https://drive.google.com/drive/folders/${folder.folder_id}` : null,
      graphics: await attached(c.env, String(episode.id)),
    });
  });

  /** Starts sending a file for one of the rundown's graphics. The browser then sends it straight to Google. */
  app.post('/episodes/:id/graphics/:elementId/uploads', async (c) => {
    const episode = await visibleEpisode(c.env, c.get('user'), c.req.param('id'));
    if (!episode) return c.json({ error: 'Episode not found.' }, 404);
    if (episode.status === 'archived') return c.json({ error: 'This episode is archived, so its graphics can’t change.' }, 403);
    if (episode.graphics_deleted_at) return c.json({ error: 'This episode’s graphics were deleted two weeks after it aired.' }, 403);
    const elementId = c.req.param('elementId');
    const body = await c.req.json<{ fileName?: string; size?: number; type?: string; elementType?: string }>().catch(() => ({}) as Record<string, never>);
    if (!isAttachable(String(body.elementType ?? ''))) return c.json({ error: 'Music and permanent graphics don’t take a file here.' }, 400);
    if (!validElementId(elementId)) return c.json({ error: 'That graphic isn’t in the rundown.' }, 400);
    const fileName = String(body.fileName ?? '').replace(/[\\/]/g, '_').slice(0, 200);
    const size = Number(body.size);
    if (!fileName || !Number.isFinite(size) || size <= 0) return c.json({ error: 'The file’s name or size is missing.' }, 400);
    try {
      const open = await openDrive(c.env);
      if (!open) return c.json({ error: NO_DRIVE }, 409);
      const folder = await episodeFolder(c.env, open.token, open.drive, String(episode.id));
      const origin = new URL(c.req.url).origin;
      const uploadUrl = await startUpload(open.token, folder, { name: fileName, size, type: String(body.type || 'application/octet-stream') }, fetch, origin);
      return c.json({ uploadUrl });
    } catch (e) {
      return c.json({ error: e instanceof DriveError ? e.message : 'Google Drive didn’t answer.' }, 502);
    }
  });

  /** Attaches a file the browser sent to the graphic, in place of the one before (deleted for good, to save space). */
  app.post('/episodes/:id/graphics/:elementId', async (c) => {
    const user = c.get('user');
    const episode = await visibleEpisode(c.env, user, c.req.param('id'));
    if (!episode) return c.json({ error: 'Episode not found.' }, 404);
    if (episode.status === 'archived') return c.json({ error: 'This episode is archived, so its graphics can’t change.' }, 403);
    const elementId = c.req.param('elementId');
    if (!validElementId(elementId)) return c.json({ error: 'That graphic isn’t in the rundown.' }, 400);
    const body = await c.req.json<{ driveFileId?: string }>().catch(() => ({}) as Record<string, never>);
    try {
      const open = await openDrive(c.env);
      if (!open) return c.json({ error: NO_DRIVE }, 409);
      const folder = await episodeFolder(c.env, open.token, open.drive, String(episode.id));
      const file = await fileInfo(open.token, String(body.driveFileId ?? ''));
      if (!file || file.trashed || !file.parents.includes(folder)) return c.json({ error: 'That file isn’t in the episode’s folder in the Drive.' }, 400);
      const before = await c.env.DB.prepare('SELECT drive_file_id, email FROM episode_graphics WHERE episode_id = ? AND element_id = ?')
        .bind(episode.id, elementId)
        .first<{ drive_file_id: string; email: string }>();
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO episode_graphics (episode_id, element_id, email, drive_file_id, file_name, size, md5, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(episode.id, elementId, open.drive.email, file.id, file.name, file.size, file.md5, user.id, Date.now())
        .run();
      if (before && before.drive_file_id !== file.id && before.email === open.drive.email) await deleteForever(open.token, before.drive_file_id).catch(() => undefined);
      // Shared by link, for Google Drive's own player in the preview window; if it doesn't work now, the
      // preview tries again.
      if (await shareByLink(open.token, file.id).then(() => true, () => false)) {
        await c.env.DB.prepare('UPDATE episode_graphics SET shared = 1 WHERE episode_id = ? AND element_id = ?').bind(episode.id, elementId).run();
      }
      return c.json({ graphics: await attached(c.env, String(episode.id)) });
    } catch (e) {
      return c.json({ error: e instanceof DriveError ? e.message : 'Google Drive didn’t answer.' }, 502);
    }
  });

  /**
   * The graphic's file, streamed from the Drive for its preview window (RG, Nov 17, 2026). Seeking works:
   * the browser's Range header goes to Google, and the part asked for comes back. Anyone who can see the
   * episode can preview it, though the file is in the admin's Drive.
   */
  app.get('/episodes/:id/graphics/:elementId/media', async (c) => {
    const episode = await visibleEpisode(c.env, c.get('user'), c.req.param('id'));
    if (!episode) return c.json({ error: 'Episode not found.' }, 404);
    const row = await c.env.DB.prepare('SELECT drive_file_id, file_name, email FROM episode_graphics WHERE episode_id = ? AND element_id = ?')
      .bind(episode.id, c.req.param('elementId'))
      .first<{ drive_file_id: string; file_name: string; email: string }>();
    if (!row) return c.json({ error: 'That graphic has no file.' }, 404);
    const open = await openDrive(c.env).catch(() => null);
    if (!open || open.drive.email !== row.email) return c.json({ error: NO_DRIVE }, 409);
    const range = c.req.header('Range');
    const google = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(row.drive_file_id)}?alt=media`, {
      headers: { Authorization: `Bearer ${open.token}`, ...(range ? { Range: range } : {}) },
    });
    if (!google.ok && google.status !== 206) return c.json({ error: `Google Drive answered ${google.status}.` }, 502);
    const headers = new Headers({ 'Content-Type': mediaType(row.file_name), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300' });
    for (const h of ['Content-Length', 'Content-Range']) {
      const v = google.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(google.body, { status: google.status, headers });
  });

  /**
   * Makes sure the graphic's file is shared by link, then gives Google Drive's player for it, for a browser
   * that can't play the file itself (Chrome and Apple ProRes; RG, Nov 17, 2026). Drive's copy has no
   * see-through parts, like Drive's own preview.
   */
  app.post('/episodes/:id/graphics/:elementId/drive-player', async (c) => {
    const episode = await visibleEpisode(c.env, c.get('user'), c.req.param('id'));
    if (!episode) return c.json({ error: 'Episode not found.' }, 404);
    const row = await c.env.DB.prepare('SELECT drive_file_id, email, shared FROM episode_graphics WHERE episode_id = ? AND element_id = ?')
      .bind(episode.id, c.req.param('elementId'))
      .first<{ drive_file_id: string; email: string; shared: number }>();
    if (!row) return c.json({ error: 'That graphic has no file.' }, 404);
    if (!row.shared) {
      try {
        const open = await openDrive(c.env);
        if (!open || open.drive.email !== row.email) return c.json({ error: NO_DRIVE }, 409);
        await shareByLink(open.token, row.drive_file_id);
        await c.env.DB.prepare('UPDATE episode_graphics SET shared = 1 WHERE episode_id = ? AND element_id = ?').bind(episode.id, c.req.param('elementId')).run();
      } catch (e) {
        return c.json({ error: e instanceof DriveError ? e.message : 'Google Drive didn’t answer.' }, 502);
      }
    }
    return c.json({ playerUrl: `https://drive.google.com/file/d/${encodeURIComponent(row.drive_file_id)}/preview` });
  });

  /** Takes the file off the graphic (deleted for good, to save space). */
  app.delete('/episodes/:id/graphics/:elementId', async (c) => {
    const episode = await visibleEpisode(c.env, c.get('user'), c.req.param('id'));
    if (!episode) return c.json({ error: 'Episode not found.' }, 404);
    if (episode.status === 'archived') return c.json({ error: 'This episode is archived, so its graphics can’t change.' }, 403);
    const elementId = c.req.param('elementId');
    const before = await c.env.DB.prepare('SELECT drive_file_id, email FROM episode_graphics WHERE episode_id = ? AND element_id = ?')
      .bind(episode.id, elementId)
      .first<{ drive_file_id: string; email: string }>();
    await c.env.DB.prepare('DELETE FROM episode_graphics WHERE episode_id = ? AND element_id = ?').bind(episode.id, elementId).run();
    if (before) {
      const open = await openDrive(c.env).catch(() => null);
      if (open && before.email === open.drive.email) await deleteForever(open.token, before.drive_file_id).catch(() => undefined);
    }
    return c.json({ graphics: await attached(c.env, String(episode.id)) });
  });
}

/** For RiGster, with the episode's RiGster key: the files attached to its rundown, by graphic. */
export async function graphicsForRiGster(env: Env, episodeId: string): Promise<{ graphics: AttachedGraphic[]; deletedAt: number | null }> {
  const row = await env.DB.prepare('SELECT graphics_deleted_at FROM episodes WHERE id = ?').bind(episodeId).first<{ graphics_deleted_at: number | null }>();
  return { graphics: await attached(env, episodeId), deletedAt: row?.graphics_deleted_at ?? null };
}

/** Deletes an episode's graphics folder for good, and forgets its files (an admin deleting the episode, say). */
export async function deleteEpisodeGraphics(env: Env, episodeId: string): Promise<void> {
  const folder = await env.DB.prepare('SELECT folder_id, email FROM episode_drive_folders WHERE episode_id = ?').bind(episodeId).first<{ folder_id: string; email: string }>();
  if (folder) {
    const open = await openDrive(env);
    if (open && open.drive.email === folder.email) await deleteForever(open.token, folder.folder_id);
  }
  await env.DB.prepare('DELETE FROM episode_graphics WHERE episode_id = ?').bind(episodeId).run();
  await env.DB.prepare('DELETE FROM episode_drive_folders WHERE episode_id = ?').bind(episodeId).run();
}

/**
 * Every morning: the graphics folders of episodes whose air date was two weeks ago or more are deleted for
 * good (RG, Nov 17, 2026), and each episode notes when. today is a YYYY-MM-DD date.
 */
export async function deleteAiredGraphics(env: Env, today: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.air_date FROM episodes e
     WHERE e.air_date IS NOT NULL AND e.graphics_deleted_at IS NULL
       AND (EXISTS (SELECT 1 FROM episode_drive_folders f WHERE f.episode_id = e.id) OR EXISTS (SELECT 1 FROM episode_graphics g WHERE g.episode_id = e.id))`,
  ).all<{ id: string; air_date: string }>();
  const deleted: string[] = [];
  for (const e of results) {
    const on = graphicsDeleteDate(e.air_date);
    if (!on || on > today) continue;
    try {
      await deleteEpisodeGraphics(env, e.id);
      await env.DB.prepare('UPDATE episodes SET graphics_deleted_at = ? WHERE id = ?').bind(Date.now(), e.id).run();
      deleted.push(e.id);
    } catch (err) {
      // Google didn't answer: it's tried again tomorrow.
      console.error(`Couldn't delete the graphics of episode ${e.id}:`, err);
    }
  }
  return deleted;
}
