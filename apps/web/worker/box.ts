// Box for the show graphics (RG, Nov 17, 2026): UT Austin's Box, connected once by an admin on the Usage
// page, with a "TSTV Rundowns" folder the website keeps tidy (a folder per show, then Permanent and one per
// episode). If UT's Box doesn't allow the website, the graphics go to Google Drive instead (drive.ts).
//
// Box's sign-in is OAuth 2.0 like Google's, with one difference: each refresh token works once, and Box
// gives a new one with each hour's access, so the caller keeps the newest (see refresh).

const AUTHORIZE = 'https://account.box.com/api/oauth2/authorize';
const TOKEN = 'https://api.box.com/oauth2/token';
const API = 'https://api.box.com/2.0';

export class BoxError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface BoxClient {
  id: string;
  secret: string;
}

export interface BoxTokens {
  accessToken: string;
  refreshToken: string;
  /** When the access ends (milliseconds since 1970). */
  accessUntil: number;
}

/** Where the admin is sent to let the website use their Box. */
export function authorizeUrl(client: BoxClient, redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({ response_type: 'code', client_id: client.id, redirect_uri: redirectUri, state }).toString();
  return url.toString();
}

async function tokens(body: Record<string, string>, fetchFn: typeof fetch): Promise<BoxTokens> {
  const response = await fetchFn(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!response.ok || !data.access_token || !data.refresh_token) {
    const ended = data.error === 'invalid_grant';
    throw new BoxError(ended ? 'The Box connection has ended. An admin needs to connect Box again on the Usage page.' : `Box didn’t give access (${data.error ?? response.status}).`, data.error);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, accessUntil: Date.now() + (data.expires_in ?? 3600) * 1000 };
}

/** Turns the code Box sends back after the admin allows the website into access and a refresh token. */
export function exchangeCode(client: BoxClient, code: string, redirectUri: string, fetchFn: typeof fetch = fetch): Promise<BoxTokens> {
  return tokens({ grant_type: 'authorization_code', code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri }, fetchFn);
}

/** A new hour's access. The refresh token given is used up: keep the new one this returns. */
export function refresh(client: BoxClient, refreshToken: string, fetchFn: typeof fetch = fetch): Promise<BoxTokens> {
  return tokens({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: client.id, client_secret: client.secret }, fetchFn);
}

async function box<T>(token: string, path: string, init: RequestInit, fetchFn: typeof fetch): Promise<T> {
  const response = await fetchFn(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { code?: string; message?: string; context_info?: { conflicts?: { id: string }[] } };
    // A folder of that name is already there: it's the one to use.
    const conflict = data.context_info?.conflicts?.[0]?.id;
    if (response.status === 409 && conflict) return { id: conflict } as T;
    throw new BoxError(`Box answered ${response.status}${data.code ? ` (${data.code})` : ''}.`, data.code);
  }
  return (response.status === 204 ? {} : await response.json()) as T;
}

/** Who the connected Box account is: its sign-in, name, and the school or company it belongs to. */
export async function whoAmI(token: string, fetchFn: typeof fetch = fetch): Promise<{ login: string; name: string | null; enterprise: string | null }> {
  const me = await box<{ login: string; name?: string; enterprise?: { name?: string } | null }>(token, '/users/me?fields=login,name,enterprise', { method: 'GET' }, fetchFn);
  return { login: me.login, name: me.name ?? null, enterprise: me.enterprise?.name ?? null };
}

/** A folder called name inside parent ("0" is the top of the account), made if it isn't there. Returns its id. */
export async function folder(token: string, name: string, parent: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const made = await box<{ id: string }>(token, '/folders?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parent: { id: parent } }) }, fetchFn);
  return made.id;
}
