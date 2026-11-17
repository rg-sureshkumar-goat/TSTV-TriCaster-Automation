// The graphics attached to a rundown (RG, Nov 17, 2026): Choose graphic, then the file's name with Replace and
// Delete beside it, and its preview window. Google Drive is made up here, so the test needs no real Drive.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const opened: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.close()));
});

async function signIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  opened.push(context);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('link', { name: 'Shows', exact: true })).toBeVisible();
  return page;
}

// A 30-second test clip, in a format every browser here plays.
const CLIP = readFileSync(new URL('./fixtures/graphic.webm', import.meta.url));

test('a graphic’s file can be previewed, replaced and deleted from the rundown', async ({ browser }) => {
  const page = await signIn(browser, 'RG (TD)');
  const ids = await page.evaluate(async () => {
    const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const show = await post('/api/shows', { name: 'Graphics Show' });
    const episode = await post(`/api/shows/${show.id}/episodes`, { title: 'Graphics Episode', airDate: '2026-11-20', airTime: '18:00' });
    return { episode: episode.id as string };
  });

  // The pretend Google Drive: connected, and holding what's attached.
  let nextName = 'A1_L3_Score.webm';
  let attached: { elementId: string; driveFileId: string; fileName: string; size: number; md5: null; uploadedBy: string; uploadedAt: number }[] = [];
  const state = () => ({ driveConnected: true, deleteOn: '2026-12-04', deletedAt: null, folderUrl: null, graphics: attached });
  await page.route(`**/api/episodes/${ids.episode}/graphics`, (route) => route.fulfill({ json: state() }));
  await page.route(`**/api/episodes/${ids.episode}/graphics/*/uploads`, (route) => route.fulfill({ json: { uploadUrl: 'https://upload.example/session' } }));
  await page.route('https://upload.example/session', (route) => route.fulfill({ json: { id: 'drive-1' }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.route(new RegExp(`/api/episodes/${ids.episode}/graphics/([^/]+)$`), async (route) => {
    const elementId = new URL(route.request().url()).pathname.split('/').pop()!;
    if (route.request().method() === 'DELETE') attached = [];
    else attached = [{ elementId, driveFileId: 'drive-1', fileName: nextName, size: CLIP.length, md5: null, uploadedBy: 'RG', uploadedAt: Date.now() }];
    await route.fulfill({ json: { graphics: attached } });
  });
  // Like the website's own route, it answers a Range request with just that part, so the video can seek.
  // Google Drive's own player, for a file the browser can't play (Chrome and Apple ProRes).
  let shared = 0;
  await page.route('**/graphics/*/drive-player', (route) => {
    shared++;
    return route.fulfill({ json: { playerUrl: 'https://drive.google.com/file/d/drive-1/preview' } });
  });
  await page.route('https://drive.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body style="background:#000;color:#fff">Drive’s player</body>' }));
  await page.route('**/graphics/*/media', (route) => {
    const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
    if (!m) return route.fulfill({ body: CLIP, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' } });
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : CLIP.length - 1;
    return route.fulfill({
      status: 206,
      body: CLIP.subarray(start, end + 1),
      contentType: 'video/webm',
      headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${CLIP.length}` },
    });
  });

  await page.goto(`/episodes/${ids.episode}`);
  await expect(page.getByText('deleted on')).toBeVisible();
  await page.getByRole('button', { name: 'Add a graphic to A1' }).click();
  await page.getByRole('menuitem').filter({ hasText: /^L3/ }).click();

  // Choose graphic: the file goes up, and its name shows, with Replace and Delete beside it.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose graphic for L3' }).click();
  await (await chooser).setFiles({ name: 'A1_L3_Score.webm', mimeType: 'video/webm', buffer: CLIP });
  await expect(page.getByRole('button', { name: 'Preview A1_L3_Score.webm' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace A1_L3_Score.webm on L3' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete A1_L3_Score.webm from L3' })).toBeVisible();

  // The name opens the preview, which plays, pauses, skips 10 seconds either way and seeks with its bar.
  await page.getByRole('button', { name: 'Preview A1_L3_Score.webm' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview of A1_L3_Score.webm' });
  await expect(preview).toBeVisible();
  const video = preview.locator('video');
  const at = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect(preview.getByRole('button', { name: 'Pause' })).toBeVisible();
  await preview.getByRole('button', { name: 'Pause' }).click();
  await expect(preview.getByRole('button', { name: 'Play' })).toBeVisible();
  await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 2));
  await preview.getByRole('button', { name: 'Forward 10 seconds' }).click();
  await expect.poll(at).toBeGreaterThanOrEqual(11.9);
  await preview.getByRole('button', { name: 'Back 10 seconds' }).click();
  await expect.poll(at).toBeLessThan(3);
  await preview.getByRole('slider', { name: 'Position in the graphic' }).fill('20');
  await expect.poll(at).toBeGreaterThanOrEqual(19.9);
  await expect(preview.locator('.graphic-preview-time').last()).toHaveText('0:30');
  await preview.getByRole('button', { name: 'Close the preview' }).click();
  await expect(preview).toBeHidden();

  // Delete takes it off, after asking.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete A1_L3_Score.webm from L3' }).click();
  await expect(page.getByRole('button', { name: 'Choose graphic for L3' })).toBeVisible();

  // An Apple ProRes .mov, which Chrome can't play: the preview shows Google Drive's player, as Drive does.
  test.skip(await page.evaluate(() => document.createElement('video').canPlayType('video/quicktime') !== ''), 'This browser plays QuickTime itself.');
  nextName = 'A1_L3_Score.mov';
  const again = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose graphic for L3' }).click();
  await (await again).setFiles({ name: 'A1_L3_Score.mov', mimeType: 'video/quicktime', buffer: CLIP });
  await page.getByRole('button', { name: 'Preview A1_L3_Score.mov' }).click();
  const drive = page.getByRole('dialog', { name: 'Preview of A1_L3_Score.mov' });
  await expect(drive.locator('iframe[title="Google Drive’s player for A1_L3_Score.mov"]')).toHaveAttribute('src', 'https://drive.google.com/file/d/drive-1/preview');
  await expect(drive.getByText('no see-through parts')).toBeVisible();
  await expect(drive.getByRole('button', { name: 'Play' })).toHaveCount(0);
  expect(shared).toBeGreaterThan(0);
});

test('an L3, OTSL or OTSR in the wrong format shows Converting…, then the converted file (RG, Nov 17, 2026)', async ({ browser }) => {
  const page = await signIn(browser, 'RG (TD)');
  const ids = await page.evaluate(async () => {
    const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const show = await post('/api/shows', { name: 'Converting Show' });
    const episode = await post(`/api/shows/${show.id}/episodes`, { title: 'Converting Episode', airDate: '2026-11-20', airTime: '18:00' });
    return { episode: episode.id as string };
  });
  let attached: Record<string, unknown>[] = [];
  let sent: { elementType?: string; formatProblems?: string[] } = {};
  await page.route(`**/api/episodes/${ids.episode}/graphics`, (route) => route.fulfill({ json: { driveConnected: true, deleteOn: '2026-12-04', deletedAt: null, folderUrl: null, graphics: attached } }));
  await page.route(`**/api/episodes/${ids.episode}/graphics/*/uploads`, (route) => route.fulfill({ json: { uploadUrl: 'https://upload.example/session' } }));
  await page.route('https://upload.example/session', (route) => route.fulfill({ json: { id: 'drive-1' }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.route(new RegExp(`/api/episodes/${ids.episode}/graphics/([^/]+)$`), async (route) => {
    const elementId = new URL(route.request().url()).pathname.split('/').pop()!;
    sent = route.request().postDataJSON();
    // The website starts converting it, as its format is wrong.
    attached = [{ elementId, driveFileId: 'drive-1', fileName: 'A1_OTSL_Map.mp4', size: CLIP.length, md5: null, uploadedBy: 'RG', uploadedAt: Date.now(), converting: true }];
    await route.fulfill({ json: { graphics: attached } });
  });

  await page.goto(`/episodes/${ids.episode}`);
  await page.getByRole('button', { name: 'Add a graphic to A1' }).click();
  await page.getByRole('menuitem').filter({ hasText: /^OTSL/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose graphic for OTSL' }).click();
  await (await chooser).setFiles({ name: 'A1_OTSL_Map.mp4', mimeType: 'video/mp4', buffer: CLIP });
  // The browser read the format before uploading, and said what's wrong.
  await expect.poll(() => sent.formatProblems?.[0]).toBe('it’s an .mp4 file, not a QuickTime .mov');
  expect(sent.elementType).toBe('OTSL');
  await expect(page.getByText('Converting A1_OTSL_Map.mp4 to 1080p ProRes 4444…')).toBeVisible();
  // GitHub's machine finishes: the converted .mov is on the graphic, marked Converted.
  attached = [{ ...attached[0], converting: false, driveFileId: 'drive-2', fileName: 'A1_OTSL_Map.mov', fixes: ['it’s an .mp4 file, not a QuickTime .mov'] }];
  await expect(page.getByRole('button', { name: 'Preview A1_OTSL_Map.mov' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.graphic-tag.converted')).toHaveText('Converted');
});
