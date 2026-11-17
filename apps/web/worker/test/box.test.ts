import { describe, expect, it } from 'vitest';
import { authorizeUrl, exchangeCode, folder, refresh, whoAmI } from '../box.ts';

/** A pretend Box that answers each request with the next answer, and remembers what it was asked. */
function boxServer(...answers: Response[]) {
  const asked: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    asked.push({ url, init });
    return answers.shift() ?? new Response('{}', { status: 500 });
  }) as unknown as typeof fetch;
  return { fetchFn, asked };
}

const client = { id: 'box-client', secret: 'shh' };

describe('Box for the show graphics (RG, Nov 17, 2026)', () => {
  it('sends the admin to Box’s page with the website’s app and where to come back', () => {
    const url = new URL(authorizeUrl(client, 'https://site.example/api/box/callback', 'state-1'));
    expect(url.origin + url.pathname).toBe('https://account.box.com/api/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', client_id: 'box-client', redirect_uri: 'https://site.example/api/box/callback', state: 'state-1' });
  });

  it('turns the code into access, and refreshes it, keeping Box’s new refresh token each time', async () => {
    const { fetchFn, asked } = boxServer(
      Response.json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }),
      Response.json({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }),
    );
    const first = await exchangeCode(client, 'code-1', 'https://site.example/api/box/callback', fetchFn);
    expect(first).toMatchObject({ accessToken: 'a1', refreshToken: 'r1' });
    expect(String(asked[0].init.body)).toContain('grant_type=authorization_code');
    const next = await refresh(client, first.refreshToken, fetchFn);
    expect(next).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
    expect(String(asked[1].init.body)).toContain('refresh_token=r1');
  });

  it('says plainly when the connection has ended', async () => {
    const { fetchFn } = boxServer(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(refresh(client, 'used-up', fetchFn)).rejects.toThrow('connect Box again');
  });

  it('reads who the account is, and makes a folder, or uses the one already there', async () => {
    const { fetchFn, asked } = boxServer(
      Response.json({ login: 'rg@utexas.edu', name: 'RG', enterprise: { name: 'The University of Texas at Austin' } }),
      Response.json({ id: '111' }, { status: 201 }),
      Response.json({ code: 'item_name_in_use', context_info: { conflicts: [{ id: '111', type: 'folder' }] } }, { status: 409 }),
    );
    expect(await whoAmI('a1', fetchFn)).toEqual({ login: 'rg@utexas.edu', name: 'RG', enterprise: 'The University of Texas at Austin' });
    expect(await folder('a1', 'TSTV Rundowns', '0', fetchFn)).toBe('111');
    expect(JSON.parse(String(asked[1].init.body))).toEqual({ name: 'TSTV Rundowns', parent: { id: '0' } });
    expect(await folder('a1', 'TSTV Rundowns', '0', fetchFn)).toBe('111');
  });
});
