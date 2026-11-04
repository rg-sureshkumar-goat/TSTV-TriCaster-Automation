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
  await rg.getByRole('button', { name: '+ Section' }).click();
  await rg.getByLabel('A4 slug').fill('Weather chat');
  await rg.getByRole('button', { name: 'A4 talent' }).click();
  await rg.getByRole('checkbox', { name: 'Everyone (cross talk)' }).check();
  await rg.getByRole('button', { name: 'Done' }).click();
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
  // A camera cue on its own line, then more words.
  await rg.keyboard.press('Enter');
  await rg.getByRole('button', { name: 'Add camera cue: Take Camera 2' }).click();
  await expect(script.locator('.cue-chip.camera')).toHaveText('Take Camera 2');
  await script.locator('p').last().click();
  await rg.keyboard.type('On camera two.');
  // Tab indents the line; Shift+Tab takes it back off (RG, Nov 2, 2026).
  await rg.keyboard.press('Enter');
  await rg.keyboard.press('Tab');
  await rg.keyboard.type('Indented line.');
  await expect(script.locator('p').last()).toHaveText('\tINDENTED LINE.');
  await rg.keyboard.press('Shift+Tab');
  await expect(script.locator('p').last()).toHaveText('INDENTED LINE.');
  await rg.keyboard.press('Home');
  await rg.keyboard.press('Tab');
  await expect(script.locator('p').last()).toHaveText('\tINDENTED LINE.');

  // The prompter, in its own window.
  const prompter = await rg.context().newPage();
  await prompter.goto(episodeUrl.replace('/episodes/', '/prompter/'));
  await expect(prompter.locator('.p-section')).toHaveCount(3);
  await expect(prompter.locator('.p-cross-talk')).toHaveText('**CROSS TALK**');
  await expect(prompter.locator('.p-section').first()).toContainText('A1');
  await expect(prompter.locator('.p-section').first()).toContainText('CAMERA 1');
  // Just the number and the camera: the speaker marker below says who reads.
  await expect(prompter.locator('.p-section').first()).not.toContainText('JORDAN');
  await expect(prompter.locator('.p-speaker')).toHaveText('JORDAN');
  await expect(prompter.locator('.p-cue')).toHaveText(['TAKE FSG', 'TAKE CAMERA 2']);
  await expect(prompter.locator('.p-text', { hasText: 'SECOND LINE.' })).toBeVisible();
  await expect(prompter.locator('.p-text', { hasText: 'INDENTED LINE.' })).toHaveText('\tINDENTED LINE.');
  await expect(prompter.getByText('FLOATED STORY')).toHaveCount(0);

  // Page Down jumps to A1 and starts it; the rundown page shows where the prompter is.
  await prompter.keyboard.press('Escape');
  await prompter.keyboard.press('PageDown');
  const bar = rg.getByRole('status', { name: 'Prompter' });
  await expect(bar).toContainText('A1 started');
  await expect(bar).toContainText('on A1');

  // The up arrow scrolls; the FSG cue fires as it crosses the reading line.
  for (let i = 0; i < 3; i++) await prompter.keyboard.press('ArrowUp');
  await expect(prompter.locator('.prompter-hud')).toContainText('▶ 3');
  await expect(bar).toContainText('Take FSG (A1)', { timeout: 20_000 });
  await expect(bar).toContainText('Camera cue (A1)', { timeout: 20_000 });
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

  // The reading-line arrow can be made bigger in the settings. It sits in the left margin, beside the text,
  // and never covers the text, however big (RG, Nov 1 and 4, 2026).
  const arrowSize = () => prompter.locator('.prompter-reading-line').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const arrowFits = () =>
    prompter.evaluate(() => {
      const range = document.createRange();
      const arrows = document.querySelectorAll('.prompter-reading-line > span');
      range.selectNodeContents(arrows[0]);
      const glyph = range.getBoundingClientRect();
      const textLeft = Math.min(...Array.from(document.querySelectorAll('.prompter-content > *')).map((el) => el.getBoundingClientRect().left));
      return { count: arrows.length, clear: glyph.right <= textLeft, onScreen: glyph.left >= 0 };
    });
  const fits = { count: 1, clear: true, onScreen: true };
  expect(await arrowFits()).toEqual(fits);
  const arrowBefore = await arrowSize();
  await prompter.keyboard.press('s');
  await prompter.getByLabel('Marker Size').fill('250');
  expect(await arrowSize()).toBeGreaterThan(arrowBefore * 1.5);
  expect(await arrowFits()).toEqual(fits);
  await prompter.keyboard.press('Escape');

  // The down arrow slows it, then runs it backwards.
  for (let i = 0; i < 5; i++) await prompter.keyboard.press('ArrowDown');
  await expect(prompter.locator('.prompter-hud')).toContainText('◀ 2 backwards');

  // H goes back to the top, stopped; the Go to section list jumps to any section and starts it.
  await prompter.keyboard.press('h');
  await expect(prompter.locator('.prompter-hud')).toContainText('Stopped');
  await expect(prompter.getByLabel('Go to section').locator('option')).toHaveText(['Go to section…', 'A1 · Open', 'A2 · Second story', 'A4 · Weather chat']);
  await prompter.getByLabel('Go to section').selectOption({ label: 'A2 · Second story' });
  await expect(bar).toContainText('A2 started');
  await expect(bar).toContainText('on A2');

  // It keeps a copy of the episode on this computer, for when the internet drops.
  await expect.poll(() => prompter.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('tstv-prompter-copy-')))).toBe(true);
});

test('a cue at the top of a reader’s part sits on the line with their name, but on its own line in the script', async ({ browser }) => {
  const rg = await signIn(browser, 'RG (TD)');
  await rg.getByPlaceholder('Show name').fill('Top Cue Show');
  await rg.getByRole('button', { name: 'Add show' }).click();
  await rg.getByPlaceholder('Title, e.g.').fill('Top Cue Episode');
  await rg.getByRole('button', { name: 'Create episode' }).click();
  await rg.getByLabel('Add an anchor').fill('Jordan');
  await rg.getByLabel('Add an anchor').press('Enter');
  await rg.getByLabel('A1 slug').fill('Open');
  await rg.getByLabel('A1 slug').press('Enter');
  await rg.getByRole('button', { name: 'A1 talent' }).click();
  await rg.getByRole('checkbox', { name: 'Jordan' }).check();
  await rg.getByRole('button', { name: 'Done' }).click();
  const episodeUrl = rg.url();

  await rg.getByRole('link', { name: 'Open the script for A1 Open' }).click();
  const script = rg.getByRole('textbox', { name: 'Script for A1' });
  await expect(script.locator('p').first()).toHaveText('{JORDAN}');
  await script.locator('p').last().click();
  await rg.getByRole('button', { name: '+ New graphic' }).click();
  await rg.getByRole('menuitem', { name: /^FSG/ }).click();
  await expect(script.locator('.cue-chip')).toHaveText('Take FSG');
  await script.locator('p').last().click();
  await rg.keyboard.type('Good evening.');
  // A blank line left by the writer stays in the script, but not on the prompter.
  await rg.keyboard.press('Enter');
  await rg.keyboard.press('Enter');
  await rg.keyboard.type('Next line.');
  await expect(script.locator('p').filter({ hasText: /^$/ })).not.toHaveCount(0);
  // In the script, the cue is still on a line of its own.
  await expect(script.locator('p').first().locator('.cue-chip')).toHaveCount(0);
  await expect(script.locator('p', { hasText: 'GOOD EVENING.' }).locator('.cue-chip')).toHaveCount(0);

  const prompter = await rg.context().newPage();
  await prompter.goto(episodeUrl.replace('/episodes/', '/prompter/'));
  const row = prompter.locator('.p-speaker-line');
  await expect(row.locator('.p-speaker')).toHaveText('JORDAN');
  await expect(row.locator('.p-cue')).toHaveText('TAKE FSG');
  const middle = async (name: string) => {
    const box = (await row.locator(name).boundingBox())!;
    return box.y + box.height / 2;
  };
  expect(Math.abs((await middle('.p-speaker')) - (await middle('.p-cue')))).toBeLessThan(30);
  await expect(prompter.locator('.p-text')).toHaveText(['GOOD EVENING.', 'NEXT LINE.']);
});

test('speeds and settings match Rundown Creator’s', async ({ browser }) => {
  const rg = await signIn(browser, 'RG (TD)');
  await rg.getByPlaceholder('Show name').fill('Settings Show');
  await rg.getByRole('button', { name: 'Add show' }).click();
  await rg.getByPlaceholder('Title, e.g.').fill('Settings Episode');
  await rg.getByRole('button', { name: 'Create episode' }).click();
  await rg.getByLabel('Add an anchor').fill('Jordan');
  await rg.getByLabel('Add an anchor').press('Enter');
  await rg.getByLabel('A1 slug').fill('Open');
  await rg.getByLabel('A1 slug').press('Enter');
  await rg.getByRole('button', { name: 'A1 talent' }).click();
  await rg.getByRole('checkbox', { name: 'Jordan' }).check();
  await rg.getByRole('button', { name: 'Done' }).click();
  const episodeUrl = rg.url();
  await rg.getByRole('link', { name: 'Open the script for A1 Open' }).click();
  const script = rg.getByRole('textbox', { name: 'Script for A1' });
  await script.locator('p').last().click();
  await rg.keyboard.type('Read this (with brackets) [as typed].');

  const prompter = await rg.context().newPage();
  await prompter.goto(episodeUrl.replace('/episodes/', '/prompter/'));
  const line = prompter.locator('.p-text', { hasText: 'READ THIS' });
  // Rundown Creator's layout: 75 pixels on the left and 30 on the right, at any screen width.
  const box = (await line.boundingBox())!;
  expect(box.x).toBe(75);
  expect(box.x + box.width).toBe(prompter.viewportSize()!.width - 30);
  // Brackets are just text.
  await expect(line).toHaveText('READ THIS (WITH BRACKETS) [AS TYPED].');
  const look = () =>
    line.evaluate((el) => {
      const c = getComputedStyle(el);
      return { size: Math.round(parseFloat(c.fontSize)), color: c.color, weight: c.fontWeight, style: c.fontStyle };
    });
  expect(await look()).toEqual({ size: 108, color: 'rgb(255, 255, 255)', weight: '700', style: 'normal' });
  // Names keep their own look: their color, at 0.8 of the text's size.
  const name = await prompter.locator('.p-speaker').first().evaluate((el) => {
    const c = getComputedStyle(el);
    return { size: Math.round(parseFloat(c.fontSize)), background: c.backgroundColor };
  });
  expect(name).toEqual({ size: 86, background: 'rgba(0, 0, 0, 0)' });

  // Rundown Creator's spacing: a header as tall as a line of the script, and 50 pixels between sections.
  expect(Math.round((await prompter.locator('.p-section').first().boundingBox())!.height)).toBe(124);
  expect((await prompter.locator('.p-gap').first().boundingBox())!.height).toBe(50);

  // Three presses of the up arrow: three pixels per screen refresh.
  for (let i = 0; i < 3; i++) await prompter.keyboard.press('ArrowUp');
  const moved = await prompter.locator('.p-section').first().evaluate(async (el) => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    await frame();
    const top = el.getBoundingClientRect().top;
    for (let i = 0; i < 10; i++) await frame();
    return top - el.getBoundingClientRect().top;
  });
  expect(moved).toBe(30);
  await prompter.keyboard.press(' ');

  // The settings can change them, and show the slug, on this computer.
  await prompter.keyboard.press('s');
  await expect(prompter.getByRole('dialog', { name: 'Prompter settings' }).getByText('Brackets', { exact: false })).toHaveCount(0);
  await prompter.getByLabel('Font size').fill('60');
  await prompter.getByLabel('Italic').check();
  await prompter.getByLabel('Show story slugs').check();
  expect(await look()).toMatchObject({ size: 80, style: 'italic' });
  await expect(prompter.locator('.p-section').first()).toContainText('OPEN');
  await prompter.getByLabel('Text color').selectOption('Yellow');
  expect((await look()).color).toBe('rgb(255, 255, 0)');
});
