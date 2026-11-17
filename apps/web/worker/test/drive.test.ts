import { describe, expect, it } from 'vitest';
import { accessToken, deleteForever, fileInfo, isSlot, makeFolder, move, rename, startUpload } from '../drive.ts';
import { episodeFolderName } from '../drive-layout.ts';

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
    expect(isSlot('transition:tease', [])).toBe(true);
    expect(isSlot('transition:lites', [])).toBe(true);
    expect(isSlot('transition:other', [])).toBe(false);
    expect(isSlot('permanent:Station ID', ['Station ID'])).toBe(true);
    expect(isSlot('permanent:Station ID', ['Show Intro'])).toBe(false);
    expect(isSlot('something', ['Station ID'])).toBe(false);
  });

  it('lets the website’s page send a file straight to Google, by naming the page’s address', async () => {
    const { fetchFn, asked } = google(new Response(null, { status: 200, headers: { Location: 'https://upload.example/session-2' } }));
    await startUpload('a1', 'folder-1', { name: 'A1_L3_Score.mov', size: 10, type: 'video/quicktime' }, fetchFn, 'https://tstv-show.tstv-rundown.workers.dev');
    expect((asked[0].init.headers as Record<string, string>).Origin).toBe('https://tstv-show.tstv-rundown.workers.dev');
  });

  it('renames and moves files, and deletes them for good (gone already is fine)', async () => {
    const { fetchFn, asked } = google(Response.json({ id: 'root' }), Response.json({ id: 'f1' }), new Response(null, { status: 204 }), new Response('{}', { status: 404 }));
    await rename('a1', 'root', 'TSTV Rundowns', fetchFn);
    expect(JSON.parse(String(asked[0].init.body))).toEqual({ name: 'TSTV Rundowns' });
    await move('a1', 'f1', 'show-folder', 'permanent-folder', fetchFn);
    expect(asked[1].url).toContain('addParents=permanent-folder');
    expect(asked[1].url).toContain('removeParents=show-folder');
    await deleteForever('a1', 'episode-folder', fetchFn);
    expect(asked[2].init.method).toBe('DELETE');
    await deleteForever('a1', 'gone', fetchFn);
  });

  it('names an episode’s folder by its air date, then its title, so they sort by date (RG, Nov 17, 2026)', () => {
    expect(episodeFolderName({ title: 'PrimeTime 11/20', air_date: '2026-11-20' })).toBe('2026-11-20 PrimeTime 11-20');
    expect(episodeFolderName({ title: 'No date yet', air_date: null })).toBe('No date yet');
  });
});

