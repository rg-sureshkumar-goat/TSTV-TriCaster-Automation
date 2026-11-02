// RiGster's show profiles (Nov 2, 2026): each show's permanent graphics, green screen and tease music,
// kept in a Google Drive so any laptop with RiGster has them. An admin connects the Drive here (Usage
// page); RiGster, with any episode's RiGster key, lists the shows' profiles, uploads files straight to
// Google, and downloads them. See drive.ts.
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { normalizeShowSettings } from '@tstv/shared';
import { base64url, cookieOptions, decodeJwtPayload, getSessionUser, randomToken } from './auth.ts';
import { accessToken, DRIVE_SCOPE, DriveError, fileInfo, isSlot, makeFolder, startUpload, trash } from './drive.ts';
import type { Env, User } from './env.ts';

type App = Hono<{ Bindings: Env; Variables: { user: User } }>;
const DRIVE_COOKIE = 'tstv_drive';
const ROOT_FOLDER = 'RiGster';

interface DriveLink {
  email: string;
  refresh_token: string;
  root_folder_id: string;
  connected_at: number;
}

const link = (env: Env) => env.DB.prepare('SELECT * FROM drive_link WHERE id = 1').first<DriveLink>();
const client = (env: Env) => ({ id: env.GOOGLE_CLIENT_ID ?? '', secret: env.GOOGLE_CLIENT_SECRET ?? '' });

/** A RiGster key from any episode lets RiGster use the show profiles: it's only given to the crew. */
async function validKey(env: Env, header: string | undefined): Promise<boolean> {
  const key = header?.replace(/^Bearer\s+/i, '');
  if (!key || !/^tstv-[A-Za-z0-9_-]{20,}$/.test(key)) return false;
  return (await env.DB.prepare('SELECT 1 FROM episodes WHERE app_key = ?').bind(key).first()) !== null;
}

async function showFolder(env: Env, token: string, drive: DriveLink, show: { id: string; name: string }): Promise<string> {
  const known = await env.DB.prepare('SELECT folder_id FROM show_drive_folders WHERE show_id = ? AND email = ?').bind(show.id, drive.email).first<{ folder_id: string }>();
  if (known) return known.folder_id;
  const id = await makeFolder(token, show.name, drive.root_folder_id);
  await env.DB.prepare('INSERT OR REPLACE INTO show_drive_folders (show_id, email, folder_id) VALUES (?, ?, ?)').bind(show.id, drive.email, id).run();
  return id;
}

async function showFor(env: Env, id: string): Promise<{ id: string; name: string; permanentGraphics: string[] } | null> {
  const row = await env.DB.prepare('SELECT id, name, settings FROM shows WHERE id = ?').bind(id).first<{ id: string; name: string; settings: string }>();
  return row ? { id: row.id, name: row.name, permanentGraphics: normalizeShowSettings(JSON.parse(row.settings)).permanentGraphics } : null;
}

export function registerProfileRoutes(app: App): void {
  // ---- Connecting the Drive (admins, signed in on the website) ----

  app.get('/drive/connect', async (c) => {
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user?.isAdmin) return c.redirect('/usage?drive=admins-only');
    if (!c.env.GOOGLE_CLIENT_ID) return c.redirect('/usage?drive=not-set-up');
    const url = new URL(c.req.url);
    const state = randomToken();
    const verifier = randomToken();
    const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    setCookie(c, DRIVE_COOKIE, JSON.stringify({ state, verifier }), cookieOptions(url, 600));
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search = new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${url.origin}/api/drive/callback`,
      response_type: 'code',
      scope: `openid email ${DRIVE_SCOPE}`,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // Offline, with the consent screen every time, so Google always gives a lasting refresh token.
      access_type: 'offline',
      prompt: 'consent select_account',
    }).toString();
    return c.redirect(google.toString());
  });

  app.get('/drive/callback', async (c) => {
    const url = new URL(c.req.url);
    const done = (result: string) => c.redirect(`/usage?drive=${result}`);
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user?.isAdmin) return done('admins-only');
    const saved = (() => {
      try {
        return JSON.parse(getCookie(c, DRIVE_COOKIE) ?? '') as { state: string; verifier: string };
      } catch {
        return null;
      }
    })();
    deleteCookie(c, DRIVE_COOKIE, { path: '/' });
    const code = c.req.query('code');
    if (c.req.query('error')) return done('cancelled');
    if (!saved || !code || c.req.query('state') !== saved.state) return done('expired');
    const tokens = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: client(c.env).id,
        client_secret: client(c.env).secret,
        redirect_uri: `${url.origin}/api/drive/callback`,
        grant_type: 'authorization_code',
        code_verifier: saved.verifier,
      }),
    });
    const data = (await tokens.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; id_token?: string; scope?: string };
    const claims = decodeJwtPayload(data.id_token);
    if (!tokens.ok || !data.refresh_token || !data.access_token || typeof claims?.email !== 'string') return done('google');
    // Google lets people untick the Drive permission on its consent screen.
    if (!data.scope?.split(' ').includes(DRIVE_SCOPE)) return done('no-drive-permission');
    try {
      const root = await makeFolder(data.access_token, ROOT_FOLDER, null);
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO drive_link (id, email, refresh_token, root_folder_id, connected_by, connected_at) VALUES (1, ?, ?, ?, ?, ?)',
      )
        .bind(claims.email.toLowerCase(), data.refresh_token, root, user.id, Date.now())
        .run();
    } catch {
      return done('google');
    }
    return done('connected');
  });

  app.get('/drive', async (c) => {
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user?.isAdmin) return c.json({ error: 'Only the admin can do that.' }, 403);
    const drive = await link(c.env);
    const files = await c.env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM show_profile_files').first<{ n: number; bytes: number }>();
    return c.json({ connected: drive !== null, email: drive?.email ?? null, connectedAt: drive?.connected_at ?? null, files: files?.n ?? 0, bytes: files?.bytes ?? 0, googleSetUp: Boolean(c.env.GOOGLE_CLIENT_ID) });
  });

  app.delete('/drive', async (c) => {
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user?.isAdmin) return c.json({ error: 'Only the admin can do that.' }, 403);
    await c.env.DB.prepare('DELETE FROM drive_link WHERE id = 1').run();
    return c.json({ ok: true });
  });

  // ---- RiGster, with a RiGster key ----

  app.use('/app/*', async (c, next) => {
    if (c.req.path === '/api/app/episode') return next();
    if (!(await validKey(c.env, c.req.header('Authorization')))) return c.json({ error: 'That RiGster key doesn’t match an episode. Copy it again from the episode’s page on the website.' }, 401);
    await next();
  });

  /** Every show, with its profile's files. current is false for a file still in a Drive that's no longer connected. */
  app.get('/app/profiles', async (c) => {
    const drive = await link(c.env);
    const { results: shows } = await c.env.DB.prepare('SELECT id, name, settings, logo FROM shows ORDER BY name COLLATE NOCASE').all<{ id: string; name: string; settings: string; logo: string | null }>();
    const { results: files } = await c.env.DB.prepare('SELECT * FROM show_profile_files').all<Record<string, unknown>>();
    return c.json({
      drive: { connected: drive !== null, email: drive?.email ?? null },
      profiles: shows.map((s) => ({
        id: s.id,
        name: s.name,
        // For RiGster's Select A Show Profile page.
        logo: s.logo ?? null,
        settings: normalizeShowSettings(JSON.parse(s.settings)),
        files: Object.fromEntries(
          files
            .filter((f) => f.show_id === s.id)
            .map((f) => [String(f.slot), { driveFileId: f.drive_file_id, fileName: f.file_name, size: f.size, md5: f.md5 ?? null, updatedAt: f.updated_at, current: drive !== null && f.email === drive.email }]),
        ),
      })),
    });
  });

  /** An hour's access to RiGster's files in the Drive, for downloading and sending them. */
  app.get('/app/drive-token', async (c) => {
    const drive = await link(c.env);
    if (!drive) return c.json({ error: 'No Google Drive is connected yet. An admin connects one on the website’s Usage page.' }, 409);
    try {
      return c.json(await accessToken(drive.refresh_token, client(c.env)));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  /** Starts sending a file into a show's folder. RiGster then sends it straight to Google. */
  app.post('/app/profiles/:showId/uploads', async (c) => {
    const body = await c.req.json<{ slot?: string; fileName?: string; size?: number; type?: string }>().catch(() => ({}) as Record<string, never>);
    const show = await showFor(c.env, c.req.param('showId'));
    if (!show) return c.json({ error: 'That show doesn’t exist any more.' }, 404);
    const slot = String(body.slot ?? '');
    if (!isSlot(slot, show.permanentGraphics)) return c.json({ error: 'That isn’t one of this show’s permanent graphics, its green screen or its music.' }, 400);
    const fileName = String(body.fileName ?? '').replace(/[\\/]/g, '_').slice(0, 200);
    const size = Number(body.size);
    if (!fileName || !Number.isFinite(size) || size <= 0) return c.json({ error: 'The file’s name or size is missing.' }, 400);
    const drive = await link(c.env);
    if (!drive) return c.json({ error: 'No Google Drive is connected yet. An admin connects one on the website’s Usage page.' }, 409);
    try {
      const { token } = await accessToken(drive.refresh_token, client(c.env));
      const folder = await showFolder(c.env, token, drive, show);
      const uploadUrl = await startUpload(token, folder, { name: fileName, size, type: String(body.type || 'application/octet-stream') });
      return c.json({ uploadUrl });
    } catch (e) {
      return c.json({ error: e instanceof DriveError ? e.message : 'Google Drive didn’t answer.' }, 502);
    }
  });

  /** Puts a file RiGster sent into the show's profile, in place of the one before (which goes to the Drive's trash). */
  app.post('/app/profiles/:showId/files', async (c) => {
    const body = await c.req.json<{ slot?: string; driveFileId?: string }>().catch(() => ({}) as Record<string, never>);
    const show = await showFor(c.env, c.req.param('showId'));
    if (!show) return c.json({ error: 'That show doesn’t exist any more.' }, 404);
    const slot = String(body.slot ?? '');
    if (!isSlot(slot, show.permanentGraphics)) return c.json({ error: 'That isn’t one of this show’s profile’s files.' }, 400);
    const drive = await link(c.env);
    if (!drive) return c.json({ error: 'No Google Drive is connected yet.' }, 409);
    try {
      const { token } = await accessToken(drive.refresh_token, client(c.env));
      const folder = await showFolder(c.env, token, drive, show);
      const file = await fileInfo(token, String(body.driveFileId ?? ''));
      if (!file || file.trashed || !file.parents.includes(folder)) return c.json({ error: 'That file isn’t in the show’s folder in the Drive.' }, 400);
      const before = await c.env.DB.prepare('SELECT drive_file_id, email FROM show_profile_files WHERE show_id = ? AND slot = ?').bind(show.id, slot).first<{ drive_file_id: string; email: string }>();
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO show_profile_files (show_id, slot, email, drive_file_id, file_name, size, md5, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(show.id, slot, drive.email, file.id, file.name, file.size, file.md5, Date.now())
        .run();
      if (before && before.drive_file_id !== file.id && before.email === drive.email) await trash(token, before.drive_file_id);
      return c.json({ ok: true, file: { driveFileId: file.id, fileName: file.name, size: file.size, md5: file.md5, current: true } });
    } catch (e) {
      return c.json({ error: e instanceof DriveError ? e.message : 'Google Drive didn’t answer.' }, 502);
    }
  });

  /** Takes a file out of the show's profile (it goes to the Drive's trash). */
  app.delete('/app/profiles/:showId/files/:slot', async (c) => {
    const showId = c.req.param('showId');
    const slot = decodeURIComponent(c.req.param('slot'));
    const before = await c.env.DB.prepare('SELECT drive_file_id, email FROM show_profile_files WHERE show_id = ? AND slot = ?').bind(showId, slot).first<{ drive_file_id: string; email: string }>();
    await c.env.DB.prepare('DELETE FROM show_profile_files WHERE show_id = ? AND slot = ?').bind(showId, slot).run();
    const drive = await link(c.env);
    if (before && drive && before.email === drive.email) {
      try {
        await trash((await accessToken(drive.refresh_token, client(c.env))).token, before.drive_file_id);
      } catch {
        // Out of the profile either way; the file can be deleted in the Drive by hand.
      }
    }
    return c.json({ ok: true });
  });
}
