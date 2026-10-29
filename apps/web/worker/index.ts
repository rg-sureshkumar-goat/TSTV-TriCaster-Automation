// The TSTV website's server. It serves the pages, handles sign-in, and offers a small API for shows,
// episodes, search and the admin page. Live editing goes through /parties/episode-room/<episode id>,
// which checks sign-in and then hands the connection to that episode's room.
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getServerByName, routePartykitRequest } from 'partyserver';
import { DEFAULT_SHOW_SETTINGS, normalizeShowSettings } from '@tstv/shared';
import { authRoutes, getSessionUser } from './auth.ts';
import type { Env, User } from './env.ts';
import { fetchUsage } from './usage.ts';

export { EpisodeRoom } from './room.ts';

type App = { Bindings: Env; Variables: { user: User } };
const app = new Hono<App>().basePath('/api');

/** Blocks changes sent from other websites (cookies alone would let them through). */
const sameOriginOnly: MiddlewareHandler<App> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.text('Forbidden', 403);
  }
  await next();
};

const signedIn: MiddlewareHandler<App> = async (c, next) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Please sign in.' }, 401);
  c.set('user', user);
  await next();
};

const adminOnly: MiddlewareHandler<App> = async (c, next) => {
  if (!c.get('user').isAdmin) return c.json({ error: 'Only the admin can do that.' }, 403);
  await next();
};

app.use('*', sameOriginOnly);
app.route('/auth', authRoutes);

// ---- The show app (Phase 4): it signs in with an episode's key instead of a Google account ----

/** The episode an app key belongs to, or null. */
async function episodeForKey(env: Env, key: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!key || !/^tstv-[A-Za-z0-9_-]{20,}$/.test(key)) return null;
  return env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.settings AS show_settings FROM episodes e JOIN shows s ON s.id = e.show_id WHERE e.app_key = ?`,
  )
    .bind(key)
    .first<Record<string, unknown>>();
}

app.get('/app/episode', async (c) => {
  const key = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const row = await episodeForKey(c.env, key);
  if (!row) return c.json({ error: 'That key doesn’t match an episode. Copy it again from the episode’s page on the website.' }, 401);
  return c.json({
    episode: episodeJson(row),
    show: { id: row.show_id, name: row.show_name, settings: normalizeShowSettings(JSON.parse(String(row.show_settings))) },
  });
});

app.use('*', signedIn);

const now = () => Date.now();

/**
 * Who can see an episode: everyone once it's published; before that, only whoever created it and admins.
 * Use with .bind(..., ...visibleTo(user)).
 */
const VISIBLE = '(e.published_at IS NOT NULL OR e.created_by = ? OR ? = 1)';
const visibleTo = (user: User) => [user.id, user.isAdmin ? 1 : 0] as const;

async function visibleEpisode(env: Env, user: User, id: string): Promise<Record<string, unknown> | null> {
  return env.DB.prepare(`SELECT e.* FROM episodes e WHERE e.id = ? AND ${VISIBLE}`)
    .bind(id, ...visibleTo(user))
    .first<Record<string, unknown>>();
}
const clean = (value: unknown, max = 200) => String(value ?? '').trim().slice(0, max);
const isDate = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: string) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

app.get('/me', (c) => c.json({ user: c.get('user') }));

// Everyone types their first and last name the first time they sign in, so they're easy to recognize
// even when their Gmail account's name isn't their real one.
app.post('/me/name', async (c) => {
  const body = await c.req.json<{ firstName?: string; lastName?: string }>();
  const firstName = clean(body.firstName, 60);
  const lastName = clean(body.lastName, 60);
  if (!firstName || !lastName) return c.json({ error: 'Type your first and last name.' }, 400);
  await c.env.DB.prepare('UPDATE users SET first_name = ?, last_name = ?, name = ? WHERE id = ?')
    .bind(firstName, lastName, `${firstName} ${lastName}`, c.get('user').id)
    .run();
  return c.json({ ok: true });
});

/**
 * A show's logo: a small image the browser already shrank to 128 pixels at most, as a data: URL.
 * Returns undefined to leave it as it is, null to remove it, or an error message.
 */
function readLogo(value: unknown): string | null | undefined | { error: string } {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return { error: 'That logo isn’t a PNG, JPEG or WebP picture.' };
  if (value.length > 150_000) return { error: 'That logo is too big. Try a smaller picture.' };
  return value;
}

// ---- Shows ----

app.get('/shows', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.settings, s.logo,
            (SELECT COUNT(*) FROM episodes e WHERE e.show_id = s.id AND e.status = 'active' AND ${VISIBLE}) AS active_episodes,
            (SELECT MAX(e.air_date) FROM episodes e WHERE e.show_id = s.id) AS latest_air_date
     FROM shows s ORDER BY s.name COLLATE NOCASE`,
  )
    .bind(...visibleTo(c.get('user')))
    .all<Record<string, unknown>>();
  return c.json({
    shows: results.map((r) => ({
      id: r.id,
      name: r.name,
      logo: r.logo ?? null,
      settings: normalizeShowSettings(JSON.parse(String(r.settings))),
      activeEpisodes: r.active_episodes,
      latestAirDate: r.latest_air_date,
    })),
  });
});

app.post('/shows', async (c) => {
  const body = await c.req.json<{ name?: string; logo?: string | null }>();
  const name = clean(body.name, 100);
  if (!name) return c.json({ error: 'Give the show a name.' }, 400);
  const logo = readLogo(body.logo);
  if (logo && typeof logo === 'object') return c.json(logo, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO shows (id, name, settings, logo, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, name, JSON.stringify(DEFAULT_SHOW_SETTINGS), logo ?? null, c.get('user').id, now(), now())
    .run();
  return c.json({ id }, 201);
});

app.get('/shows/:id', async (c) => {
  const show = await c.env.DB.prepare('SELECT id, name, settings, logo FROM shows WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!show) return c.json({ error: 'Show not found.' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.air_date, e.air_time, e.status, e.summary, e.updated_at, e.published_at, e.created_by, u.name AS created_by_name
     FROM episodes e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.show_id = ? AND ${VISIBLE} ORDER BY e.air_date DESC, e.created_at DESC`,
  )
    .bind(show.id, ...visibleTo(c.get('user')))
    .all<Record<string, unknown>>();
  return c.json({
    show: { id: show.id, name: show.name, logo: show.logo ?? null, settings: normalizeShowSettings(JSON.parse(String(show.settings))) },
    episodes: results.map(episodeJson),
  });
});

app.patch('/shows/:id', async (c) => {
  const body = await c.req.json<{ name?: string; settings?: unknown; logo?: string | null }>();
  const show = await c.env.DB.prepare('SELECT id, name, settings, logo FROM shows WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!show) return c.json({ error: 'Show not found.' }, 404);
  const name = body.name === undefined ? String(show.name) : clean(body.name, 100);
  if (!name) return c.json({ error: 'Give the show a name.' }, 400);
  const settings = body.settings === undefined ? JSON.parse(String(show.settings)) : normalizeShowSettings(body.settings);
  const logo = readLogo(body.logo);
  if (logo && typeof logo === 'object') return c.json(logo, 400);
  await c.env.DB.prepare('UPDATE shows SET name = ?, settings = ?, logo = ?, updated_at = ? WHERE id = ?')
    .bind(name, JSON.stringify(settings), logo === undefined ? (show.logo ?? null) : logo, now(), show.id)
    .run();
  return c.json({ ok: true, settings });
});

// ---- Episodes ----

function episodeJson(r: Record<string, unknown>) {
  return {
    id: r.id,
    showId: r.show_id,
    title: r.title,
    airDate: r.air_date ?? '',
    airTime: r.air_time ?? '',
    status: r.status,
    summary: r.summary ? JSON.parse(String(r.summary)) : null,
    updatedAt: r.updated_at,
    createdByName: r.created_by_name ?? null,
    createdById: r.created_by ?? null,
    publishedAt: r.published_at ?? null,
  };
}

app.post('/shows/:id/episodes', async (c) => {
  const body = await c.req.json<{ title?: string; airDate?: string; airTime?: string }>();
  const showId = c.req.param('id');
  if (!(await c.env.DB.prepare('SELECT 1 FROM shows WHERE id = ?').bind(showId).first())) return c.json({ error: 'Show not found.' }, 404);
  const title = clean(body.title, 120);
  const airDate = clean(body.airDate, 10);
  const airTime = clean(body.airTime, 5);
  if (!title) return c.json({ error: 'Give the episode a title.' }, 400);
  if (!isDate(airDate) || !isTime(airTime)) return c.json({ error: 'Check the air date and time.' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO episodes (id, show_id, title, air_date, air_time, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, showId, title, airDate || null, airTime || null, 'active', c.get('user').id, now(), now())
    .run();
  return c.json({ id }, 201);
});

app.get('/episodes/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT e.*, u.name AS created_by_name, s.name AS show_name, s.settings AS show_settings
     FROM episodes e JOIN shows s ON s.id = e.show_id LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ? AND ${VISIBLE}`,
  )
    .bind(c.req.param('id'), ...visibleTo(c.get('user')))
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'Episode not found.' }, 404);
  return c.json({
    episode: episodeJson(row),
    show: { id: row.show_id, name: row.show_name, settings: normalizeShowSettings(JSON.parse(String(row.show_settings))) },
  });
});

app.patch('/episodes/:id', async (c) => {
  const body = await c.req.json<{ title?: string; airDate?: string; airTime?: string }>();
  const row = await visibleEpisode(c.env, c.get('user'), c.req.param('id'));
  if (!row) return c.json({ error: 'Episode not found.' }, 404);
  if (row.status === 'archived') return c.json({ error: 'This episode is archived, so it can’t be changed.' }, 409);
  const title = body.title === undefined ? String(row.title) : clean(body.title, 120);
  const airDate = body.airDate === undefined ? String(row.air_date ?? '') : clean(body.airDate, 10);
  const airTime = body.airTime === undefined ? String(row.air_time ?? '') : clean(body.airTime, 5);
  if (!title) return c.json({ error: 'Give the episode a title.' }, 400);
  if (!isDate(airDate) || !isTime(airTime)) return c.json({ error: 'Check the air date and time.' }, 400);
  await c.env.DB.prepare('UPDATE episodes SET title = ?, air_date = ?, air_time = ?, updated_at = ? WHERE id = ?')
    .bind(title, airDate || null, airTime || null, now(), row.id)
    .run();
  return c.json({ ok: true });
});

async function setArchived(env: Env, episodeId: string, archived: boolean): Promise<void> {
  await env.DB.prepare('UPDATE episodes SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?')
    .bind(archived ? 'archived' : 'active', archived ? now() : null, now(), episodeId)
    .run();
  const room = await getServerByName(env.EpisodeRoom, episodeId);
  await room.fetch(
    new Request(`https://room/parties/episode-room/${episodeId}/archived`, { method: 'POST', body: JSON.stringify({ archived }) }),
  );
}

// Publishing: the producer (whoever created the episode) or an admin makes a finished rundown visible to everyone.
app.post('/episodes/:id/publish', async (c) => {
  const user = c.get('user');
  const row = await visibleEpisode(c.env, user, c.req.param('id'));
  if (!row) return c.json({ error: 'Episode not found.' }, 404);
  if (row.created_by !== user.id && !user.isAdmin) return c.json({ error: 'Only the producer who created this episode, or an admin, can publish it.' }, 403);
  await c.env.DB.prepare('UPDATE episodes SET published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?').bind(now(), now(), row.id).run();
  return c.json({ ok: true });
});

app.post('/episodes/:id/unpublish', async (c) => {
  const user = c.get('user');
  const row = await visibleEpisode(c.env, user, c.req.param('id'));
  if (!row) return c.json({ error: 'Episode not found.' }, 404);
  if (row.created_by !== user.id && !user.isAdmin) return c.json({ error: 'Only the producer who created this episode, or an admin, can do that.' }, 403);
  await c.env.DB.prepare('UPDATE episodes SET published_at = NULL, updated_at = ? WHERE id = ?').bind(now(), row.id).run();
  return c.json({ ok: true });
});

// The episode's key for the show app: the producer who created the episode and admins can see it, and
// make a new one (which cuts off any app using the old one).
function newAppKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `tstv-${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

async function appKeyFor(c: Context<App, '/episodes/:id/app-key'>, renew: boolean) {
  const user = c.get('user');
  const row = await visibleEpisode(c.env, user, c.req.param('id'));
  if (!row) return c.json({ error: 'Episode not found.' }, 404);
  if (row.created_by !== user.id && !user.isAdmin) return c.json({ error: 'Only the producer who created this episode, or an admin, can get its show app key.' }, 403);
  let key = row.app_key ? String(row.app_key) : null;
  if (!key || renew) {
    key = newAppKey();
    await c.env.DB.prepare('UPDATE episodes SET app_key = ? WHERE id = ?').bind(key, row.id).run();
  }
  return c.json({ key });
}

app.get('/episodes/:id/app-key', (c) => appKeyFor(c, false));
app.post('/episodes/:id/app-key', (c) => appKeyFor(c, true));

// Start or End live broadcast (RG, Oct 29, 2026): the producer who created the episode, or an admin.
// While it's live, the show app's automation follows the prompter.
app.post('/episodes/:id/live', async (c) => {
  const user = c.get('user');
  const row = await visibleEpisode(c.env, user, c.req.param('id'));
  if (!row) return c.json({ error: 'Episode not found.' }, 404);
  if (row.created_by !== user.id && !user.isAdmin) return c.json({ error: 'Only the producer who created this episode, or an admin, can start or end the live broadcast.' }, 403);
  const { live } = await c.req.json<{ live?: boolean }>();
  if (live && row.status === 'archived') return c.json({ error: 'This episode is archived, so it can’t go live.' }, 409);
  const room = await getServerByName(c.env.EpisodeRoom, String(row.id));
  const response = await room.fetch(
    new Request(`https://room/parties/episode-room/${row.id}/live`, { method: 'POST', body: JSON.stringify({ live: Boolean(live), by: { id: user.id, name: user.name } }) }),
  );
  return c.json(await response.json());
});

app.post('/episodes/:id/archive', async (c) => {
  const id = c.req.param('id');
  if (!(await visibleEpisode(c.env, c.get('user'), id))) return c.json({ error: 'Episode not found.' }, 404);
  await setArchived(c.env, id, true);
  return c.json({ ok: true });
});

app.post('/episodes/:id/unarchive', adminOnly, async (c) => {
  const id = c.req.param('id');
  if (!(await c.env.DB.prepare('SELECT 1 FROM episodes WHERE id = ?').bind(id).first())) return c.json({ error: 'Episode not found.' }, 404);
  await setArchived(c.env, id, false);
  return c.json({ ok: true });
});

// Deleting an episode erases its rundown and scripts for good, to save space. Admins only.
app.delete('/episodes/:id', adminOnly, async (c) => {
  const id = c.req.param('id');
  if (!(await c.env.DB.prepare('SELECT 1 FROM episodes WHERE id = ?').bind(id).first())) return c.json({ error: 'Episode not found.' }, 404);
  await c.env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(id).run();
  const room = await getServerByName(c.env.EpisodeRoom, id);
  await room.fetch(new Request(`https://room/parties/episode-room/${id}/delete`, { method: 'POST' }));
  return c.json({ ok: true });
});

app.get('/search', async (c) => {
  const q = clean(c.req.query('q'), 100);
  if (q.length < 2) return c.json({ episodes: [] });
  const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE (e.title LIKE ? ESCAPE '\\' OR e.search_text LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\') AND ${VISIBLE}
     ORDER BY e.air_date DESC LIMIT 50`,
  )
    .bind(like, like, like, ...visibleTo(c.get('user')))
    .all<Record<string, unknown>>();
  return c.json({ episodes: results.map((r) => ({ ...episodeJson(r), showName: r.show_name })) });
});

// ---- Admin: who can sign in ----

app.get('/admin/people', adminOnly, async (c) => {
  const users = await c.env.DB.prepare('SELECT id, email, name, is_admin, created_at, last_seen_at FROM users ORDER BY name COLLATE NOCASE').all<Record<string, unknown>>();
  const invites = await c.env.DB.prepare('SELECT email, as_admin, created_at FROM invites ORDER BY email').all<Record<string, unknown>>();
  return c.json({
    users: users.results.map((u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin === 1, lastSeenAt: u.last_seen_at })),
    invites: invites.results.map((i) => ({ email: i.email, asAdmin: i.as_admin === 1, createdAt: i.created_at })),
  });
});

// Today's Cloudflare usage against the free limits. Needs CF_ACCOUNT_ID and CF_API_TOKEN (docs/PHASE-2.md).
app.get('/admin/usage', adminOnly, async (c) => {
  if (!c.env.CF_ACCOUNT_ID || !c.env.CF_API_TOKEN) return c.json({ configured: false });
  const items = await fetchUsage(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN);
  return c.json({ configured: true, items, checkedAt: Date.now() });
});

app.post('/admin/invites', adminOnly, async (c) => {
  // asAdmin: "Give Admin Access" was ticked. Otherwise they get a contributor account.
  const { email, asAdmin } = await c.req.json<{ email?: string; asAdmin?: boolean }>();
  const address = clean(email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return c.json({ error: 'That doesn’t look like an email address.' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(address).first()) return c.json({ error: 'That person can already sign in.' }, 409);
  await c.env.DB.prepare('INSERT OR REPLACE INTO invites (email, invited_by, created_at, as_admin) VALUES (?, ?, ?, ?)')
    .bind(address, c.get('user').id, now(), asAdmin ? 1 : 0)
    .run();
  return c.json({ ok: true }, 201);
});

app.delete('/admin/invites/:email', adminOnly, async (c) => {
  await c.env.DB.prepare('DELETE FROM invites WHERE email = ?').bind(c.req.param('email')).run();
  return c.json({ ok: true });
});

app.delete('/admin/users/:id', adminOnly, async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: 'You can’t remove yourself.' }, 400);
  // Their name stays on anything they wrote; they just can't sign in any more.
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

app.post('/admin/users/:id/admin', adminOnly, async (c) => {
  const { isAdmin } = await c.req.json<{ isAdmin?: boolean }>();
  const id = c.req.param('id');
  if (id === c.get('user').id && !isAdmin) return c.json({ error: 'You can’t remove your own admin rights.' }, 400);
  await c.env.DB.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(isAdmin ? 1 : 0, id).run();
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'Not found.' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/parties/')) {
      const response = await routePartykitRequest(request, env as unknown as Cloudflare.Env, {
        // Live connections: only signed-in people, and archived episodes are read-only.
        onBeforeConnect: async (req, lobby) => {
          // The show app connects with the episode's key: it can follow the episode, but not edit it.
          const key = new URL(req.url).searchParams.get('key');
          if (key) {
            const episode = await episodeForKey(env, key);
            if (!episode || episode.id !== lobby.name) return new Response('That key doesn’t match this episode.', { status: 401 });
            const headers = new Headers(req.headers);
            headers.set('x-tstv-user', JSON.stringify({ id: 'show-app', name: 'Show app' }));
            headers.set('x-tstv-readonly', '1');
            headers.set('x-tstv-app', '1');
            return new Request(req, { headers });
          }
          const user = await getSessionUser(req, env);
          if (!user) return new Response('Please sign in.', { status: 401 });
          const episode = await env.DB.prepare(`SELECT e.status FROM episodes e WHERE e.id = ? AND ${VISIBLE}`)
            .bind(lobby.name, ...visibleTo(user))
            .first<{ status: string }>();
          if (!episode) return new Response('Episode not found.', { status: 404 });
          const headers = new Headers(req.headers);
          headers.set('x-tstv-user', JSON.stringify({ id: user.id, name: user.name }));
          headers.set('x-tstv-readonly', episode.status === 'archived' ? '1' : '0');
          return new Request(req, { headers });
        },
        // Rooms are only reachable from the outside as live connections.
        onBeforeRequest: () => new Response('Forbidden', { status: 403 }),
      });
      return response ?? new Response('Not found', { status: 404 });
    }
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
