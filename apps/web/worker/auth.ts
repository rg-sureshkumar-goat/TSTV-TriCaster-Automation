// Sign-in: "Sign in with Google" or "Sign in with Microsoft" (school Microsoft 365 accounts and personal
// ones, added Oct 29, 2026), limited to people an admin has invited, plus a pretend sign-in for local
// development only. Sessions are random tokens in an HttpOnly cookie; the database stores only their hash.
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env, User } from './env.ts';

const SESSION_COOKIE = 'tstv_session';
const OAUTH_COOKIE = 'tstv_oauth';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

type AppContext = Context<{ Bindings: Env; Variables: { user: User } }>;

/**
 * Pretend users for local development. RG is the admin. Casey is brand new, so is asked for a first and
 * last name; the others already gave theirs.
 */
export const DEV_USERS = [
  { email: 'rg@dev.local', name: 'RG (TD)' },
  { email: 'alex@dev.local', name: 'Alex Producer' },
  { email: 'sam@dev.local', name: 'Sam Writer' },
  { email: 'casey@dev.local', name: 'casey.new123', isNew: true },
];

function adminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function devLoginEnabled(env: Env, url: URL): boolean {
  return env.DEV_LOGIN === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (const b of array) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cookieOptions(url: URL, maxAgeSeconds: number) {
  return { httpOnly: true, secure: url.protocol === 'https:', sameSite: 'Lax' as const, path: '/', maxAge: maxAgeSeconds };
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    picture: (row.picture as string) ?? null,
    isAdmin: row.is_admin === 1,
    needsName: !row.first_name || !row.last_name,
  };
}

/** The signed-in user for a request, or null. Extends the session when it's past halfway. */
export async function getSessionUser(request: Request, env: Env): Promise<User | null> {
  const cookie = request.headers.get('Cookie') ?? '';
  const token = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  )
    .bind(hash, Date.now())
    .first<Record<string, unknown>>();
  if (!row) return null;
  const now = Date.now();
  if (Number(row.expires_at) - now < (SESSION_DAYS / 2) * DAY) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_DAYS * DAY, hash).run();
    await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, row.id).run();
  }
  return rowToUser(row);
}

async function startSession(c: AppContext, userId: string): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * DAY)
    .run();
  await c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, userId).run();
  setCookie(c, SESSION_COOKIE, token, cookieOptions(new URL(c.req.url), SESSION_DAYS * 24 * 3600));
}

/**
 * Lets a person in if they already have an account, were invited, or are listed as an admin.
 * Creates or updates their account and returns it, or returns null if they aren't allowed.
 */
async function admitPerson(env: Env, email: string, name: string, picture: string | null): Promise<User | null> {
  const db = env.DB;
  const isAdminEmail = adminEmails(env).has(email.toLowerCase());
  const existing = await db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').bind(email).first<Record<string, unknown>>();
  if (existing) {
    // The name they typed in wins over Google's.
    const current = existing.first_name && existing.last_name ? String(existing.name) : name;
    await db
      .prepare('UPDATE users SET name = ?, picture = ?, is_admin = CASE WHEN ? THEN 1 ELSE is_admin END WHERE id = ?')
      .bind(current, picture, isAdminEmail ? 1 : 0, existing.id)
      .run();
    return rowToUser({ ...existing, name: current, picture, is_admin: isAdminEmail ? 1 : existing.is_admin });
  }
  const invite = await db.prepare('SELECT email, as_admin FROM invites WHERE lower(email) = lower(?)').bind(email).first<{ as_admin: number }>();
  if (!invite && !isAdminEmail) return null;
  const isAdmin = isAdminEmail || invite?.as_admin === 1;
  const user: User = { id: crypto.randomUUID(), email, name, picture, isAdmin, needsName: true };
  await db
    .prepare('INSERT INTO users (id, email, name, picture, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, email, name, picture, isAdmin ? 1 : 0, Date.now())
    .run();
  await db.prepare('DELETE FROM invites WHERE lower(email) = lower(?)').bind(email).run();
  return user;
}

export const authRoutes = new Hono<{ Bindings: Env; Variables: { user: User } }>();

/** What sign-in options this site offers (the sign-in page asks before showing buttons). */
authRoutes.get('/options', (c) => {
  const url = new URL(c.req.url);
  return c.json({
    google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(c.env.MICROSOFT_CLIENT_ID && c.env.MICROSOFT_CLIENT_SECRET),
    dev: devLoginEnabled(c.env, url) ? DEV_USERS : null,
  });
});

// ---- Sign in with Google (OAuth 2.0 authorization code flow with PKCE) ----

authRoutes.get('/google/start', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.text('Google sign-in is not set up yet.', 503);
  const url = new URL(c.req.url);
  const state = randomToken();
  const verifier = randomToken();
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const returnTo = safeReturnTo(c.req.query('returnTo'));
  setCookie(c, OAUTH_COOKIE, JSON.stringify({ state, verifier, returnTo }), cookieOptions(url, 600));
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return c.redirect(google.toString());
});

authRoutes.get('/google/callback', async (c) => {
  const url = new URL(c.req.url);
  const fail = (reason: string) => c.redirect(`/signin?error=${reason}`);
  const saved = (() => {
    try {
      return JSON.parse(getCookie(c, OAUTH_COOKIE) ?? '') as { state: string; verifier: string; returnTo: string };
    } catch {
      return null;
    }
  })();
  deleteCookie(c, OAUTH_COOKIE, { path: '/' });
  const code = c.req.query('code');
  if (!saved || !code || c.req.query('state') !== saved.state) return fail('expired');
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return fail('not-configured');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenResponse.ok) return fail('google');
  const { id_token: idToken } = (await tokenResponse.json()) as { id_token?: string };
  // The ID token came straight from Google over HTTPS, so its contents can be trusted without
  // re-checking the signature (OpenID Connect Core, section 3.1.3.7). We still check who it's for.
  const claims = decodeJwtPayload(idToken);
  if (
    !claims ||
    claims.aud !== c.env.GOOGLE_CLIENT_ID ||
    !['https://accounts.google.com', 'accounts.google.com'].includes(String(claims.iss)) ||
    Number(claims.exp) * 1000 < Date.now() ||
    claims.email_verified !== true ||
    typeof claims.email !== 'string'
  ) {
    return fail('google');
  }
  const user = await admitPerson(c.env, claims.email, String(claims.name ?? claims.email), typeof claims.picture === 'string' ? claims.picture : null);
  if (!user) return fail('not-invited');
  await startSession(c, user.id);
  return c.redirect(saved.returnTo);
});

// ---- Sign in with Microsoft (the same flow, with Microsoft's "common" sign-in for any school, work or
// personal Microsoft account) ----

const MICROSOFT = 'https://login.microsoftonline.com/common/oauth2/v2.0';
/** The directory every personal Microsoft account (Outlook.com, Hotmail) belongs to. */
const PERSONAL_ACCOUNTS = '9188040d-6c67-4c5b-b112-36a304b66dad';

authRoutes.get('/microsoft/start', async (c) => {
  if (!c.env.MICROSOFT_CLIENT_ID) return c.text('Microsoft sign-in is not set up yet.', 503);
  const url = new URL(c.req.url);
  const state = randomToken();
  const verifier = randomToken();
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const returnTo = safeReturnTo(c.req.query('returnTo'));
  setCookie(c, OAUTH_COOKIE, JSON.stringify({ state, verifier, returnTo }), cookieOptions(url, 600));
  const microsoft = new URL(`${MICROSOFT}/authorize`);
  microsoft.search = new URLSearchParams({
    client_id: c.env.MICROSOFT_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/microsoft/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return c.redirect(microsoft.toString());
});

authRoutes.get('/microsoft/callback', async (c) => {
  const url = new URL(c.req.url);
  const fail = (reason: string) => c.redirect(`/signin?error=${reason}`);
  const saved = (() => {
    try {
      return JSON.parse(getCookie(c, OAUTH_COOKIE) ?? '') as { state: string; verifier: string; returnTo: string };
    } catch {
      return null;
    }
  })();
  deleteCookie(c, OAUTH_COOKIE, { path: '/' });
  // A school that hasn't allowed apps like this one sends the person back with an error instead of a code.
  if (c.req.query('error')) return fail(c.req.query('error_description')?.includes('AADSTS65001') || c.req.query('error') === 'consent_required' ? 'microsoft-school' : 'microsoft');
  const code = c.req.query('code');
  if (!saved || !code || c.req.query('state') !== saved.state) return fail('expired');
  if (!c.env.MICROSOFT_CLIENT_ID || !c.env.MICROSOFT_CLIENT_SECRET) return fail('not-configured');

  const tokenResponse = await fetch(`${MICROSOFT}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.MICROSOFT_CLIENT_ID,
      client_secret: c.env.MICROSOFT_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/microsoft/callback`,
      grant_type: 'authorization_code',
      code_verifier: saved.verifier,
      scope: 'openid email profile',
    }),
  });
  if (!tokenResponse.ok) return fail('microsoft');
  const { id_token: idToken } = (await tokenResponse.json()) as { id_token?: string };
  // Straight from Microsoft over HTTPS, like Google's (see above). We check who it's for and who issued it.
  const claims = decodeJwtPayload(idToken);
  if (
    !claims ||
    claims.aud !== c.env.MICROSOFT_CLIENT_ID ||
    typeof claims.tid !== 'string' ||
    claims.iss !== `https://login.microsoftonline.com/${claims.tid}/v2.0` ||
    Number(claims.exp) * 1000 < Date.now()
  ) {
    return fail('microsoft');
  }
  const email = await microsoftEmail(c.env, claims);
  if (!email) return fail('microsoft');
  const user = await admitPerson(c.env, email, String(claims.name ?? email), null);
  if (!user) return fail('not-invited');
  await startSession(c, user.id);
  return c.redirect(saved.returnTo);
});

/**
 * The email a Microsoft account signs in as. Its sign-in name (preferred_username) can be trusted: a school
 * can only give its people names in domains it has proved it owns, and a personal account's is its own
 * email. Its email field can be typed in by any school's IT, so it's only used when its domain is the sign-in
 * name's or one above it: UT's people sign in as abc123@eid.utexas.edu, but are invited at name@utexas.edu.
 * The one that's already a person, an invite or an admin wins.
 */
export async function microsoftEmail(env: Env, claims: Record<string, unknown>): Promise<string | null> {
  const isEmail = (value: unknown): value is string => typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  const signInName = isEmail(claims.preferred_username) ? claims.preferred_username.toLowerCase() : null;
  if (!signInName) return null;
  const candidates = [signInName];
  const domain = signInName.split('@')[1];
  if (claims.tid !== PERSONAL_ACCOUNTS && isEmail(claims.email)) {
    const email = claims.email.toLowerCase();
    const emailDomain = email.split('@')[1];
    if (email !== signInName && (domain === emailDomain || domain.endsWith(`.${emailDomain}`))) candidates.unshift(email);
  }
  const admins = adminEmails(env);
  for (const candidate of candidates) {
    if (admins.has(candidate)) return candidate;
    const known = await env.DB.prepare('SELECT 1 FROM users WHERE lower(email) = ? UNION SELECT 1 FROM invites WHERE lower(email) = ?').bind(candidate, candidate).first();
    if (known) return candidate;
  }
  return candidates[0];
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Only allow returning to a page on this site. */
function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

// ---- Pretend sign-in, local development only ----

authRoutes.post('/dev-login', async (c) => {
  if (!devLoginEnabled(c.env, new URL(c.req.url))) return c.text('Not available', 404);
  const { email } = await c.req.json<{ email?: string }>();
  const dev = DEV_USERS.find((u) => u.email === email);
  if (!dev) return c.text('Unknown pretend user', 400);
  // Pretend users are always allowed in locally.
  const db = c.env.DB;
  if (!(await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(dev.email).first())) {
    await db.prepare('INSERT OR IGNORE INTO invites (email, created_at) VALUES (?, ?)').bind(dev.email, Date.now()).run();
  }
  const user = await admitPerson(c.env, dev.email, dev.name, null);
  if (!user) return c.text('Could not sign in', 500);
  if (!('isNew' in dev)) {
    const [first, ...rest] = dev.name.split(' ');
    await db.prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ? AND first_name IS NULL').bind(first, rest.join(' ') || first, user.id).run();
  }
  await startSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post('/signout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});
