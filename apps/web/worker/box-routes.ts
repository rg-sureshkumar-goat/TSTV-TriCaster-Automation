// Connecting Box (RG, Nov 17, 2026; step 1 of the show graphics in Box): an admin connects the Box account
// on the Usage page, which also tells us whether UT Austin's Box lets the website in at all. See box.ts.
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cookieOptions, getSessionUser, randomToken } from './auth.ts';
import { authorizeUrl, BoxError, exchangeCode, folder, refresh, whoAmI, type BoxClient } from './box.ts';
import type { Env, User } from './env.ts';

type App = Hono<{ Bindings: Env; Variables: { user: User } }>;
const BOX_COOKIE = 'tstv_box';
export const BOX_ROOT_FOLDER = 'TSTV Rundowns';

interface BoxLink {
  login: string;
  name: string | null;
  enterprise: string | null;
  refresh_token: string;
  access_token: string;
  access_until: number;
  root_folder_id: string;
  connected_at: number;
}

const client = (env: Env): BoxClient => ({ id: env.BOX_CLIENT_ID ?? '', secret: env.BOX_CLIENT_SECRET ?? '' });
const link = (env: Env) => env.DB.prepare('SELECT * FROM box_link WHERE id = 1').first<BoxLink>();

/**
 * An hour's access to the connected Box, refreshed when it's nearly over. Box's refresh tokens work once,
 * so the new one is saved straight away; the update only lands if no one else refreshed first.
 */
export async function boxAccess(env: Env, fetchFn: typeof fetch = fetch): Promise<{ token: string; rootFolder: string } | null> {
  const box = await link(env);
  if (!box) return null;
  if (box.access_until > Date.now() + 5 * 60_000) return { token: box.access_token, rootFolder: box.root_folder_id };
  const fresh = await refresh(client(env), box.refresh_token, fetchFn);
  const saved = await env.DB.prepare('UPDATE box_link SET refresh_token = ?, access_token = ?, access_until = ? WHERE id = 1 AND refresh_token = ?')
    .bind(fresh.refreshToken, fresh.accessToken, fresh.accessUntil, box.refresh_token)
    .run();
  if (!saved.meta.changes) {
    // Another request refreshed it at the same moment: use what it saved.
    const now = await link(env);
    return now ? { token: now.access_token, rootFolder: now.root_folder_id } : null;
  }
  return { token: fresh.accessToken, rootFolder: box.root_folder_id };
}

export function registerBoxRoutes(app: App): void {
  app.get('/box/connect', async (c) => {
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user?.isAdmin) return c.redirect('/usage?box=admins-only');
    if (!c.env.BOX_CLIENT_ID || !c.env.BOX_CLIENT_SECRET) return c.redirect('/usage?box=not-set-up');
    const url = new URL(c.req.url);
    const state = randomToken();
    setCookie(c, BOX_COOKIE, state, cookieOptions(url, 600));
    return c.redirect(authorizeUrl(client(c.env), `${url.origin}/api/box/callback`, state));
  });

  app.get('/box/callback', async (c) => {
    const url = new URL(c.req.url);
    const done = (result: string, detail?: string) => c.redirect(`/usage?box=${result}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`);
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user?.isAdmin) return done('admins-only');
    const state = getCookie(c, BOX_COOKIE);
    deleteCookie(c, BOX_COOKIE, { path: '/' });
    const error = c.req.query('error');
    // Pressing Deny on Box's page; anything else Box says no to is most likely UT's admins not allowing the app.
    if (error === 'access_denied') return done('cancelled');
    if (error) return done('refused', `${error}${c.req.query('error_description') ? `: ${c.req.query('error_description')}` : ''}`);
    const code = c.req.query('code');
    if (!state || !code || c.req.query('state') !== state) return done('expired');
    try {
      const tokens = await exchangeCode(client(c.env), code, `${url.origin}/api/box/callback`);
      const me = await whoAmI(tokens.accessToken);
      // Making the top folder proves the website can write to this Box, not just sign in to it.
      const root = await folder(tokens.accessToken, BOX_ROOT_FOLDER, '0');
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO box_link (id, login, name, enterprise, refresh_token, access_token, access_until, root_folder_id, connected_by, connected_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(me.login.toLowerCase(), me.name, me.enterprise, tokens.refreshToken, tokens.accessToken, tokens.accessUntil, root, user.id, Date.now())
        .run();
    } catch (e) {
      return done('refused', e instanceof BoxError ? e.message : 'Box didn’t answer.');
    }
    return done('connected');
  });

  app.get('/box', async (c) => {
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user?.isAdmin) return c.json({ error: 'Only the admin can do that.' }, 403);
    const box = await link(c.env);
    // A quick check that the connection still works, so the page can say so.
    let working: boolean | null = null;
    if (box) working = await boxAccess(c.env).then(() => true, () => false);
    return c.json({
      setUp: Boolean(c.env.BOX_CLIENT_ID && c.env.BOX_CLIENT_SECRET),
      connected: box !== null,
      working,
      login: box?.login ?? null,
      name: box?.name ?? null,
      enterprise: box?.enterprise ?? null,
      connectedAt: box?.connected_at ?? null,
      folder: box ? `https://app.box.com/folder/${box.root_folder_id}` : null,
    });
  });

  app.delete('/box', async (c) => {
    const user = await getSessionUser(c.req.raw, c.env);
    if (!user?.isAdmin) return c.json({ error: 'Only the admin can do that.' }, 403);
    await c.env.DB.prepare('DELETE FROM box_link WHERE id = 1').run();
    return c.json({ ok: true });
  });
}
