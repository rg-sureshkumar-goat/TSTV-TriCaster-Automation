import { describe, expect, it } from 'vitest';
import { accessToken, fileInfo, isSlot, makeFolder, startUpload } from '../drive.ts';

/** A pretend Google that answers each request with the next answer, and remembers what it was asked. */
function google(...answers: Response[]) {
  const asked: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    asked.push({ url, init });
    return answers.shift() ?? new Response('{}', { status: 500 });
  }) as unknown as typeof fetch;
  return { fetchFn, asked };
}

const client = { id: 'client', secret: 'shh' };

describe('RiGster’s Google Drive', () => {
  it('gets an hour’s access from the refresh token, and reuses it', async () => {
    const { fetchFn, asked } = google(Response.json({ access_token: 'a1', expires_in: 3600 }));
    const first = await accessToken('refresh-1', client, fetchFn);
    expect(first.token).toBe('a1');
    expect(String(asked[0].init.body)).toContain('grant_type=refresh_token');
    expect((await accessToken('refresh-1', client, fetchFn)).token).toBe('a1');
    expect(asked).toHaveLength(1);
  });

  it('says plainly when the connection has ended', async () => {
    const { fetchFn } = google(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(accessToken('refresh-2', client, fetchFn)).rejects.toThrow('connect it again');
  });

  it('makes folders, and starts an upload into one, returning where to send the file', async () => {
    const { fetchFn, asked } = google(Response.json({ id: 'folder-1' }), new Response(null, { status: 200, headers: { Location: 'https://upload.example/session-1' } }));
    expect(await makeFolder('a1', 'TSTV News PrimeTime', 'root-1', fetchFn)).toBe('folder-1');
    expect(JSON.parse(String(asked[0].init.body))).toEqual({ name: 'TSTV News PrimeTime', mimeType: 'application/vnd.google-apps.folder', parents: ['root-1'] });
    expect(await startUpload('a1', 'folder-1', { name: 'Station ID.mov', size: 1234, type: 'video/quicktime' }, fetchFn)).toBe('https://upload.example/session-1');
    expect(asked[1].url).toContain('uploadType=resumable');
    expect((asked[1].init.headers as Record<string, string>)['X-Upload-Content-Length']).toBe('1234');
  });

  it('reads a file’s details, or null when it isn’t there', async () => {
    const { fetchFn } = google(Response.json({ id: 'f1', name: 'Station ID.mov', size: '1234', md5Checksum: 'abc', parents: ['folder-1'] }), new Response('{}', { status: 404 }));
    expect(await fileInfo('a1', 'f1', fetchFn)).toEqual({ id: 'f1', name: 'Station ID.mov', size: 1234, md5: 'abc', parents: ['folder-1'], trashed: false });
    expect(await fileInfo('a1', 'gone', fetchFn)).toBeNull();
  });

  it('knows a show profile’s slots: green screen, music, and the show’s own permanent graphics', () => {
    expect(isSlot('greenScreen', [])).toBe(true);
    expect(isSlot('music', [])).toBe(true);
    expect(isSlot('permanent:Station ID', ['Station ID'])).toBe(true);
    expect(isSlot('permanent:Station ID', ['Show Intro'])).toBe(false);
    expect(isSlot('something', ['Station ID'])).toBe(false);
  });
});
