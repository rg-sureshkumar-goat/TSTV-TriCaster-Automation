// Phase 1 in real browsers: two people build one rundown at the same time.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function signIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('link', { name: 'Shows', exact: true })).toBeVisible();
  return page;
}

const row = (page: Page, label: string) =>
  page.locator('tr.section-row', { has: page.locator('td.num-col', { hasText: new RegExp(`^${label}(Floated)?$`) }) });
const slugLink = (page: Page, label: string, slug: string) => page.getByRole('link', { name: `Open the script for ${label} ${slug}` });

test('two people build one rundown together', async ({ browser }) => {
  const rg = await signIn(browser, 'RG (TD)');

  // RG adds a show and an episode that airs at 7 PM.
  await rg.getByPlaceholder('Show name').fill('E2E News');
  await rg.getByRole('button', { name: 'Add show' }).click();
  await expect(rg.getByRole('heading', { name: 'E2E News' })).toBeVisible();
  await rg.getByPlaceholder('Title, e.g.').fill('Test Episode');
  await rg.locator('input[type=date]').fill('2026-10-30');
  await rg.locator('input[type=time]').fill('19:00');
  await rg.getByRole('button', { name: 'Create episode' }).click();
  await expect(rg.getByText('● Live')).toBeVisible();
  const episodeUrl = rg.url();

  // A new episode starts with Block A and section A1.
  await rg.getByLabel('A1 slug').fill('Cold Open');
  await rg.getByLabel('A1 estimated length').fill('0:45');
  await rg.getByLabel('A1 estimated length').press('Enter');

  // It's a draft: Sam can't see it yet.
  await expect(rg.getByText('Draft · not visible to everyone yet')).toBeVisible();
  const sam = await signIn(browser, 'Sam Writer');
  await sam.goto(episodeUrl);
  await expect(sam.getByText('Episode not found.')).toBeVisible();

  // RG publishes the rundown; now Sam sees RG's work, with the slug as a link to its script.
  rg.once('dialog', (dialog) => dialog.accept());
  await rg.getByRole('button', { name: 'Publish rundown' }).click();
  await expect(rg.getByText('Published', { exact: true })).toBeVisible();
  await sam.goto(episodeUrl);
  await expect(slugLink(sam, 'A1', 'Cold Open')).toBeVisible();

  // Sam adds a section; RG sees it appear and sees who wrote it.
  await sam.getByRole('button', { name: '+ Section' }).click();
  await sam.getByLabel('A2 slug').fill('Basketball Wins');
  await sam.getByLabel('A2 estimated length').fill('1:30');
  await sam.getByLabel('A2 estimated length').press('Enter');
  await expect(slugLink(rg, 'A2', 'Basketball Wins')).toBeVisible();
  await expect(row(rg, 'A2').locator('.edited-col')).toContainText('Sam Writer');
  await expect(rg.locator('.presence')).toHaveAttribute('title', /Sam Writer/);

  // Timing: 0:45 + 1:30 = 2:15 of a 30:00 show, and back-times count back from 7:30 PM.
  await expect(rg.locator('.timing-bar')).toContainText('Total 2:15');
  await expect(rg.locator('.timing-bar')).toContainText('27:45 under');
  await expect(row(rg, 'A2')).toContainText('7:28:30 PM');
  await expect(row(rg, 'A1')).toContainText('7:27:45 PM');

  // Setting the type and talent works through the dropdowns, and syncs.
  await expect(rg.getByLabel('A2 type').locator('option')).toHaveText(['—', 'Intro', 'Tease', 'Reader', 'Cross Talk', 'Package', 'SOT']);
  await rg.getByLabel('A2 type').selectOption('Reader');
  await expect(sam.getByLabel('A2 type')).toHaveValue('Reader');

  // The producer enters this episode's anchors and correspondents; they sync, and a section whose
  // Talent box names one gets that person's color.
  await rg.getByLabel('Add an anchor').fill('Jordan');
  await rg.getByLabel('Add an anchor').press('Enter');
  await rg.getByLabel('Add a correspondent').fill('Riley Park');
  await rg.getByLabel('Add a correspondent').press('Enter');
  await expect(sam.getByRole('region', { name: 'On-air talent' })).toContainText('Jordan');
  await expect(sam.getByRole('region', { name: 'On-air talent' })).toContainText('Riley Park');

  // Writer is typed in; Talent is picked from this episode's anchors and correspondents. Both sync.
  await rg.getByRole('textbox', { name: 'A2 writer' }).fill('Sam');
  await expect(rg.getByLabel('A2 talent').locator('option')).toHaveText(['—', 'Jordan', 'Riley Park']);
  await rg.getByLabel('A2 talent').selectOption('Jordan');
  await expect(sam.getByLabel('A2 writer')).toHaveValue('Sam');
  await expect(sam.getByLabel('A2 talent')).toHaveValue('Jordan');
  await expect(row(sam, 'A2').locator('.talent-cell .dot')).toBeVisible();
  await rg.getByRole('textbox', { name: 'A2 notes' }).fill('Confirm final score');
  await expect(sam.getByLabel('A2 notes')).toHaveValue('Confirm final score');

  // Graphics: A2 is a reader with an L3, and a VO playing over the anchor.
  await rg.getByRole('button', { name: 'Add a graphic to A2' }).click();
  await rg.getByRole('menuitem', { name: /^L3/ }).click();
  await rg.getByRole('button', { name: 'Add a graphic to A2' }).click();
  await rg.getByRole('menuitem', { name: /^VO/ }).click();
  await rg.getByRole('button', { name: 'A2 graphic 2: VO' }).click();
  await rg.getByLabel('Name (optional)').fill('Highlights');
  await rg.getByRole('button', { name: 'Done' }).click();
  await expect(sam.getByRole('button', { name: 'A2 graphic 2: VO Highlights' })).toBeVisible();
  // Sam moves the VO first; RG sees the new order.
  await sam.getByRole('button', { name: 'A2 graphic 2: VO Highlights' }).click();
  await sam.getByRole('button', { name: '← Earlier' }).click();
  await sam.getByRole('button', { name: 'Done' }).click();
  await expect(rg.getByRole('button', { name: 'A2 graphic 1: VO Highlights' })).toBeVisible();
  await expect(rg.getByRole('button', { name: 'A2 graphic 2: L3' })).toBeVisible();

  // Floating A2 keeps it but drops it from the total, for both people.
  await rg.getByRole('button', { name: 'Actions for A2' }).click();
  await rg.getByRole('menuitem', { name: /^Float/ }).click();
  await expect(sam.locator('.timing-bar')).toContainText('Total 0:45');
  await expect(row(sam, 'A2')).toContainText('Floated');

  // A second block, a section in it, and moving a section between blocks renumbers everything.
  await rg.getByRole('button', { name: '+ Block' }).click();
  await rg.getByRole('button', { name: '+ Section' }).click();
  await rg.getByLabel('B1 slug').fill('Weather');
  await rg.getByRole('button', { name: 'Actions for B1' }).click();
  await rg.getByRole('menuitem', { name: 'Move up' }).click();
  await expect(slugLink(sam, 'A3', 'Weather')).toBeVisible();

  // Clicking a slug opens its script page. RG and Sam type in the same script at once.
  await slugLink(rg, 'A1', 'Cold Open').click();
  await expect(rg.getByRole('heading', { name: /A1 · Cold Open/ })).toBeVisible();
  await rg.getByLabel('Script for A1').fill('Good evening and welcome to TSTV News.');
  await expect(rg.locator('.script-stats')).toContainText('7 words');
  await expect(rg.locator('.script-stats')).toContainText('Read time about 0:03');
  await slugLink(sam, 'A1', 'Cold Open').click();
  await expect(sam.getByLabel('Script for A1')).toHaveValue('Good evening and welcome to TSTV News.');
  await sam.getByLabel('Script for A1').press('End');
  await sam.getByLabel('Script for A1').pressSequentially(' The Longhorns won tonight.');
  await expect(rg.getByLabel('Script for A1')).toHaveValue('Good evening and welcome to TSTV News. The Longhorns won tonight.');
  await expect(rg.locator('.script-stats')).toContainText('11 words');
  await expect(rg.locator('.script-stats')).toContainText('0:04–0:05');
  await expect(rg.locator('.script-foot')).toContainText('Edited by RG (TD), Sam Writer');
  await rg.goto(episodeUrl);
  await sam.goto(episodeUrl);

  // Est.: A1's typed-in 0:45 wins; cleared, it falls back to the script's read time (11 words, about 0:04).
  await expect(rg.locator('.timing-bar')).toContainText('Total 0:45');
  await rg.getByLabel('A1 estimated length').fill('');
  await rg.getByLabel('A1 estimated length').press('Enter');
  await expect(rg.getByLabel('A1 estimated length')).toHaveAttribute('placeholder', '0:04');
  await expect(sam.locator('.timing-bar')).toContainText('Total 0:04');

  // Export CSV includes the rows and who wrote them.
  const downloadPromise = rg.waitForEvent('download');
  await rg.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(download.suggestedFilename()).toBe('E2E News - Test Episode rundown.csv');
  expect(csv).toContain('A1,Cold Open');
  expect(csv).toContain('"VO Highlights, L3"');
  expect(csv).toContain('A2,Basketball Wins,Reader,Sam,Jordan');
  expect(csv).toContain('Sam Writer');

  // Export PDF makes a real PDF file.
  const pdfPromise = rg.waitForEvent('download');
  await rg.getByRole('button', { name: 'Export PDF' }).click();
  const pdf = await pdfPromise;
  expect(pdf.suggestedFilename()).toBe('E2E News - Test Episode rundown.pdf');
  expect(readFileSync((await pdf.path())!).subarray(0, 5).toString()).toBe('%PDF-');

  // Search finds the episode by a slug. The room saves search text a few seconds after the last edit.
  await expect
    .poll(async () => JSON.stringify(await (await rg.request.get('/api/search?q=Highlights')).json()), { timeout: 20_000 })
    .toContain('Test Episode');
  await rg.getByRole('link', { name: 'Search' }).click();
  await rg.getByPlaceholder('Search').fill('Highlights');
  await expect(rg.getByRole('link', { name: /Test Episode/ })).toBeVisible();
  await rg.goto(episodeUrl);

  // Archiving makes it read-only, including on Sam's open page.
  rg.once('dialog', (dialog) => dialog.accept());
  await rg.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(rg.getByText('Archived · read-only')).toBeVisible();
  await expect(rg.getByLabel('A1 writer')).toBeDisabled();
  await expect(sam.getByText('Archived · read-only')).toBeVisible();
  await expect(sam.getByLabel('A1 writer')).toBeDisabled();
});

test('only signed-in people get in, and only the admin manages people', async ({ browser, request }) => {
  // Without signing in, the server refuses data and live connections.
  expect((await request.get('/api/shows')).status()).toBe(401);
  expect((await request.get('/parties/episode-room/anything', { headers: { Upgrade: 'websocket' } })).status()).toBe(401);
  // Changes sent from another website are refused even with a cookie.
  expect((await request.post('/api/shows', { headers: { Origin: 'https://evil.example' }, data: { name: 'x' } })).status()).toBe(403);

  // Sam isn't an admin: no People page, and the admin API says no.
  const sam = await signIn(browser, 'Sam Writer');
  await expect(sam.getByRole('link', { name: 'People' })).toHaveCount(0);
  expect((await sam.request.get('/api/admin/people')).status()).toBe(403);

  // RG is the admin and can invite someone.
  const rg = await signIn(browser, 'RG (TD)');
  await rg.getByRole('link', { name: 'People' }).click();
  await rg.getByPlaceholder('name@gmail.com').fill('new.writer@gmail.com');
  await rg.getByRole('button', { name: 'Invite' }).click();
  await expect(rg.getByText('new.writer@gmail.com', { exact: true })).toBeVisible();
  await expect(rg.getByRole('cell', { name: 'Sam Writer', exact: true })).toBeVisible();
});
