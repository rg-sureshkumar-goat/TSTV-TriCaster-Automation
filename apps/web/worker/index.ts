// The TSTV website's server. It serves the pages, handles sign-in, and offers a small API for shows,
// episodes, search and the admin page. Live editing goes through /parties/episode-room/<episode id>,
// which checks sign-in and then hands the connection to that episode's room.
import { Hono, type MiddlewareHandler } from 'hono';
import { getServerByName, routePartykitRequest } from 'partyserver';
import { DEFAULT_SHOW_SETTINGS, normalizeShowSettings } from '@tstv/shared';
import { authRoutes, getSessionUser } from './auth.ts';
import type { Env, User } from './env.ts';

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
app.use('*', signedIn);

const now = () => Date.now();
const clean = (value: unknown, max = 200) => String(value ?? '').trim().slice(0, max);
const isDate = (v: string) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: string) => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

app.get('/me', (c) => c.json({ user: c.get('user') }));

// ---- Shows ----

app.get('/shows', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.settings,
            (SELECT COUNT(*) FROM episodes e WHERE e.show_id = s.id AND e.status = 'active') AS active_episodes,
            (SELECT MAX(e.air_date) FROM episodes e WHERE e.show_id = s.id) AS latest_air_date
     FROM shows s ORDER BY s.name COLLATE NOCASE`,
  ).all<Record<string, unknown>>();
  return c.json({
    shows: results.map((r) => ({
      id: r.id,
      name: r.name,
      settings: normalizeShowSettings(JSON.parse(String(r.settings))),
      activeEpisodes: r.active_episodes,
      latestAirDate: r.latest_air_date,
    })),
  });
});

app.post('/shows', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = clean(body.name, 100);
  if (!name) return c.json({ error: 'Give the show a name.' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO shows (id, name, settings, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name, JSON.stringify(DEFAULT_SHOW_SETTINGS), c.get('user').id, now(), now())
    .run();
  return c.json({ id }, 201);
});

app.get('/shows/:id', async (c) => {
  const show = await c.env.DB.prepare('SELECT id, name, settings FROM shows WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!show) return c.json({ error: 'Show not found.' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.air_date, e.air_time, e.status, e.summary, e.updated_at, u.name AS created_by_name
     FROM episodes e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.show_id = ? ORDER BY e.air_date DESC, e.created_at DESC`,
  )
    .bind(show.id)
    .all<Record<string, unknown>>();
  return c.json({
    show: { id: show.id, name: show.name, settings: normalizeShowSettings(JSON.parse(String(show.settings))) },
    episodes: results.map(episodeJson),
  });
});

app.patch('/shows/:id', async (c) => {
  const body = await c.req.json<{ name?: string; settings?: unknown }>();
  const show = await c.env.DB.prepare('SELECT id, name, settings FROM shows WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!show) return c.json({ error: 'Show not found.' }, 404);
  const name = body.name === undefined ? String(show.name) : clean(body.name, 100);
  if (!name) return c.json({ error: 'Give the show a name.' }, 400);
  const settings = body.settings === undefined ? JSON.parse(String(show.settings)) : normalizeShowSettings(body.settings);
  await c.env.DB.prepare('UPDATE shows SET name = ?, settings = ?, updated_at = ? WHERE id = ?').bind(name, JSON.stringify(settings), now(), show.id).run();
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
     FROM episodes e JOIN shows s ON s.id = e.show_id LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'Episode not found.' }, 404);
  return c.json({
    episode: episodeJson(row),
    show: { id: row.show_id, name: row.show_name, settings: normalizeShowSettings(JSON.parse(String(row.show_settings))) },
  });
});

app.patch('/episodes/:id', async (c) => {
  const body = await c.req.json<{ title?: string; airDate?: string; airTime?: string }>();
  const row = await c.env.DB.prepare('SELECT * FROM episodes WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
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

app.post('/episodes/:id/archive', async (c) => {
  const id = c.req.param('id');
  if (!(await c.env.DB.prepare('SELECT 1 FROM episodes WHERE id = ?').bind(id).first())) return c.json({ error: 'Episode not found.' }, 404);
  await setArchived(c.env, id, true);
  return c.json({ ok: true });
});

app.post('/episodes/:id/unarchive', adminOnly, async (c) => {
  const id = c.req.param('id');
  if (!(await c.env.DB.prepare('SELECT 1 FROM episodes WHERE id = ?').bind(id).first())) return c.json({ error: 'Episode not found.' }, 404);
  await setArchived(c.env, id, false);
  return c.json({ ok: true });
});

app.get('/search', async (c) => {
  const q = clean(c.req.query('q'), 100);
  if (q.length < 2) return c.json({ episodes: [] });
  const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.title LIKE ? ESCAPE '\\' OR e.search_text LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\'
     ORDER BY e.air_date DESC LIMIT 50`,
  )
    .bind(like, like, like)
    .all<Record<string, unknown>>();
  return c.json({ episodes: results.map((r) => ({ ...episodeJson(r), showName: r.show_name })) });
});

// ---- Admin: who can sign in ----

app.get('/admin/people', adminOnly, async (c) => {
  const users = await c.env.DB.prepare('SELECT id, email, name, is_admin, created_at, last_seen_at FROM users ORDER BY name COLLATE NOCASE').all<Record<string, unknown>>();
  const invites = await c.env.DB.prepare('SELECT email, created_at FROM invites ORDER BY email').all<Record<string, unknown>>();
  return c.json({
    users: users.results.map((u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: u.is_admin === 1, lastSeenAt: u.last_seen_at })),
    invites: invites.results.map((i) => ({ email: i.email, createdAt: i.created_at })),
  });
});

app.post('/admin/invites', adminOnly, async (c) => {
  const { email } = await c.req.json<{ email?: string }>();
  const address = clean(email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return c.json({ error: 'That doesn’t look like an email address.' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(address).first()) return c.json({ error: 'That person can already sign in.' }, 409);
  await c.env.DB.prepare('INSERT OR IGNORE INTO invites (email, invited_by, created_at) VALUES (?, ?, ?)').bind(address, c.get('user').id, now()).run();
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
          const user = await getSessionUser(req, env);
          if (!user) return new Response('Please sign in.', { status: 401 });
          const episode = await env.DB.prepare('SELECT status FROM episodes WHERE id = ?').bind(lobby.name).first<{ status: string }>();
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
