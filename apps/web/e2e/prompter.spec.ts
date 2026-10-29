// In a real browser: the prompter scrolls an episode's scripts, fires cues at the reading line, and keeps
// the line being read in place while someone edits the script.
import { expect, test, type Browser, type Page } from '@playwright/test';

async function signIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('link', { name: 'Shows', exact: true })).toBeVisible();
  return page;
}

test('the prompter scrolls the scripts, fires cues and keeps its place during edits', async ({ browser }) => {
  const rg = await signIn(browser, 'RG (TD)');
  await rg.getByPlaceholder('Show name').fill('Prompter Show');
  await rg.getByRole('button', { name: 'Add show' }).click();
  await rg.getByPlaceholder('Title, e.g.').fill('Prompter Episode');
  await rg.getByRole('button', { name: 'Create episode' }).click();
  await rg.getByLabel('Add an anchor').fill('Jordan');
  await rg.getByLabel('Add an anchor').press('Enter');
  await rg.getByLabel('A1 slug').fill('Open');
  await rg.getByLabel('A1 slug').press('Enter');
  await rg.getByRole('button', { name: 'A1 talent' }).click();
  await rg.getByRole('checkbox', { name: 'Jordan' }).check();
  await rg.getByRole('button', { name: 'Done' }).click();
  await rg.getByRole('button', { name: '+ Section' }).click();
  await rg.getByLabel('A2 slug').fill('Second story');
  await rg.getByRole('button', { name: '+ Section' }).click();
  await rg.getByLabel('A3 slug').fill('Floated story');
  await rg.getByRole('button', { name: 'Actions for A3' }).click();
  await rg.getByRole('menuitem', { name: /^Float/ }).click();
  const episodeUrl = rg.url();

  // A1's script: Jordan's name is already there; two lines, then a new FSG cue on its own line.
  await rg.getByRole('link', { name: 'Open the script for A1 Open' }).click();
  const script = rg.getByRole('textbox', { name: 'Script for A1' });
  await expect(script.locator('p').first()).toHaveText('{JORDAN}');
  await script.locator('p').last().click();
  await rg.keyboard.type('First line.');
  await rg.keyboard.press('Enter');
  for (let i = 1; i <= 6; i++) {
    await rg.keyboard.type(`Line ${i} of the story.`);
    await rg.keyboard.press('Enter');
  }
  await rg.keyboard.type('Second line.');
  await rg.getByRole('button', { name: '+ New graphic' }).click();
  await rg.getByRole('menuitem', { name: /^FSG/ }).click();
  await expect(script.locator('.cue-chip')).toHaveText('Take FSG');
  await script.locator('p').last().click();
  await rg.keyboard.type('After the graphic.');

  // The prompter, in its own window.
  const prompter = await rg.context().newPage();
  await prompter.goto(episodeUrl.replace('/episodes/', '/prompter/'));
  await expect(prompter.locator('.p-section')).toHaveCount(2);
  await expect(prompter.locator('.p-section').first()).toContainText('A1');
  await expect(prompter.locator('.p-section').first()).toContainText('CAMERA 1');
  // Just the number and the camera: the speaker marker below says who reads.
  await expect(prompter.locator('.p-section').first()).not.toContainText('JORDAN');
  await expect(prompter.locator('.p-speaker')).toHaveText('JORDAN');
  await expect(prompter.locator('.p-cue')).toHaveText('TAKE FSG');
  await expect(prompter.locator('.p-text', { hasText: 'SECOND LINE.' })).toBeVisible();
  await expect(prompter.getByText('FLOATED STORY')).toHaveCount(0);

  // Page Down jumps to A1 and starts it; the rundown page shows where the prompter is.
  await prompter.keyboard.press('Escape');
  await prompter.keyboard.press('PageDown');
  const bar = rg.getByRole('status', { name: 'Prompter' });
  await expect(bar).toContainText('A1 started');
  await expect(bar).toContainText('on A1');

  // The up arrow scrolls; the FSG cue fires as it crosses the reading line.
  for (let i = 0; i < 15; i++) await prompter.keyboard.press('ArrowUp');
  await expect(prompter.locator('.prompter-hud')).toContainText('▶ 15');
  await expect(bar).toContainText('Take FSG (A1)', { timeout: 20_000 });
  await prompter.keyboard.press(' ');
  await expect(prompter.locator('.prompter-hud')).toContainText('Paused');

  // Someone adds a line near the top of the script: what's on screen doesn't move.
  const topOf = () => prompter.locator('.p-text', { hasText: 'AFTER THE GRAPHIC.' }).evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const before = await topOf();
  await script.locator('p', { hasText: 'FIRST LINE.' }).click();
  await rg.keyboard.press('Home');
  await rg.keyboard.type('A brand new line.');
  await rg.keyboard.press('Enter');
  await expect(prompter.locator('.p-text', { hasText: 'A BRAND NEW LINE.' })).toHaveCount(1);
  expect(Math.abs((await topOf()) - before)).toBeLessThanOrEqual(2);

  // The reading-line arrows can be made bigger in the settings.
  const arrowSize = () => prompter.locator('.prompter-reading-line').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const arrowsBefore = await arrowSize();
  await prompter.keyboard.press('s');
  await prompter.getByLabel('Marker Size').fill('200');
  expect(await arrowSize()).toBeGreaterThan(arrowsBefore * 1.5);
  await prompter.keyboard.press('Escape');

  // The down arrow slows it, then runs it backwards.
  for (let i = 0; i < 17; i++) await prompter.keyboard.press('ArrowDown');
  await expect(prompter.locator('.prompter-hud')).toContainText('◀ 2 backwards');

  // It keeps a copy of the episode on this computer, for when the internet drops.
  await expect.poll(() => prompter.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('tstv-prompter-copy-')))).toBe(true);
});
