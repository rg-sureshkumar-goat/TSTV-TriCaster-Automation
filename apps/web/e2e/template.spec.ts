// In a real browser: a show's rundown template (RG, Nov 2, 2026). New rundowns start as a copy of it,
// with its sections, graphics, scripts and columns; changing it afterward leaves them as they were.
import { expect, test, type Browser, type Page } from '@playwright/test';

async function signIn(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('link', { name: 'Shows', exact: true })).toBeVisible();
  return page;
}

/** The rundown's column headings, without the template's ⋯ menu buttons. */
const headings = async (page: Page) => (await page.locator('table.rundown thead th').allTextContents()).map((t) => t.replace('⋯', '').trim());
/** Picks an item from a column heading's ⋯ menu in the template. */
async function columnMenu(page: Page, column: string, item: string) {
  await page.getByRole('button', { name: `Actions for ${column} column` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Moves a column left with its menu until it's at this place among the headings, one move at a time. */
async function moveLeftTo(page: Page, column: string, place: number) {
  for (let at = (await headings(page)).indexOf(column); at > place; at--) {
    await columnMenu(page, column, 'Move Left');
    await expect.poll(async () => (await headings(page)).indexOf(column)).toBe(at - 1);
  }
}

test('new rundowns start from the show’s template, and later changes to it leave them alone', async ({ browser }) => {
  const rg = await signIn(browser, 'RG (TD)');
  await rg.getByPlaceholder('Show name').fill('Template Show');
  await rg.getByRole('button', { name: 'Add show' }).click();
  await expect(rg.getByRole('heading', { name: 'Template Show' })).toBeVisible();
  const showUrl = rg.url();

  // Show settings → Edit rundown template.
  await rg.getByRole('button', { name: 'Show settings' }).click();
  await rg.getByRole('button', { name: 'Edit rundown template' }).click();
  await expect(rg.getByRole('heading', { name: 'Rundown template' })).toBeVisible();
  await expect(rg.getByText('Any Changes Made to this Template Will Not Affect Already Published Rundowns')).toBeVisible();
  const templateUrl = rg.url();

  // The template: starter talent (Anchor 1), and a Show Open section Anchor 1 reads, with the Show Intro and its script.
  await rg.getByLabel('Add an anchor').fill('Anchor 1');
  await rg.getByLabel('Add an anchor').press('Enter');
  await rg.getByRole('button', { name: 'A1 talent' }).click();
  await rg.getByRole('checkbox', { name: 'Anchor 1' }).check();
  await rg.getByRole('button', { name: 'Done' }).click();
  await rg.getByLabel('A1 slug').fill('Show Open');
  await rg.getByLabel('A1 slug').press('Enter');
  await rg.getByRole('button', { name: 'Add a graphic to A1' }).click();
  await rg.getByRole('menuitem', { name: /Show Intro/ }).click();
  await rg.getByRole('link', { name: 'Open the script for A1 Show Open' }).click();
  const script = rg.getByRole('textbox', { name: 'Script for A1' });
  await expect(script.locator('p').first()).toHaveText('{ANCHOR 1}');
  await script.locator('p').last().click();
  await rg.keyboard.type('Good evening and welcome.');
  await rg.keyboard.press('Escape');
  await rg.goto(templateUrl);

  // Columns, from each heading's ⋯ menu: Writer is removed, and Notes moves left to just after Slug.
  // Slug, Camera and Graphics can't be removed. A removed column comes back from the + at the end.
  await columnMenu(rg, 'Writer', 'Remove This Column');
  await moveLeftTo(rg, 'Notes', 3);
  for (const locked of ['Slug', 'Camera', 'Graphics']) {
    await rg.getByRole('button', { name: `Actions for ${locked} column` }).click();
    await expect(rg.getByRole('menuitem', { name: 'Move Right' })).toBeVisible();
    await expect(rg.getByRole('menuitem', { name: 'Remove This Column' })).toHaveCount(0);
    await rg.keyboard.press('Escape');
  }
  await columnMenu(rg, 'Headline', 'Remove This Column');
  await rg.getByRole('button', { name: 'Add a column back' }).click();
  await rg.getByRole('menuitem', { name: 'Headline' }).click();
  await expect.poll(async () => (await headings(rg)).at(-2)).toBe('Headline');
  await moveLeftTo(rg, 'Headline', 7);
  await expect.poll(() => headings(rg)).toEqual(['', '#', 'Slug', 'Notes', 'Story Type', 'Talent', 'Camera', 'Headline', 'Graphics', 'Assign Graphics', 'Est.', 'Back-time', 'Last edit', '+']);

  // The template isn't an episode: it's not in the show's list.
  await rg.goto(showUrl);
  await expect(rg.getByText('Rundown template')).toHaveCount(0);

  // A new rundown starts as a copy of it.
  await rg.getByPlaceholder('Title, e.g.').fill('Nov 3 Show');
  await rg.getByRole('button', { name: 'Create episode' }).click();
  await expect(rg.getByRole('link', { name: 'Open the script for A1 Show Open' })).toBeVisible();
  await expect(rg.locator('tr.section-row').first()).toContainText('Show Intro');
  await expect.poll(() => headings(rg)).toEqual(['', '#', 'Slug', 'Notes', 'Story Type', 'Talent', 'Camera', 'Headline', 'Graphics', 'Assign Graphics', 'Est.', 'Back-time', 'Last edit']);
  const episodeUrl = rg.url();
  await rg.getByRole('link', { name: 'Open the script for A1 Show Open' }).click();
  await expect(rg.getByRole('textbox', { name: 'Script for A1' })).toContainText('GOOD EVENING AND WELCOME.');
  await rg.keyboard.press('Escape');
  await rg.goto(episodeUrl);

  // Its starter talent came too: renaming Anchor 1 to the real anchor changes the section and the script.
  await rg.getByRole('button', { name: 'Rename Anchor 1' }).click();
  await rg.getByLabel('New name for Anchor 1').fill('Jordan');
  await rg.getByLabel('New name for Anchor 1').press('Enter');
  await expect(rg.getByRole('button', { name: 'Rename Jordan' })).toBeVisible();
  await expect(rg.getByRole('button', { name: 'A1 talent' })).toContainText('Jordan');
  await rg.getByRole('link', { name: 'Open the script for A1 Show Open' }).click();
  await expect(rg.getByRole('textbox', { name: 'Script for A1' }).locator('p').first()).toHaveText('{JORDAN}');
  await expect(rg.getByRole('textbox', { name: 'Script for A1' })).toContainText('GOOD EVENING AND WELCOME.');

  // Changing the template afterward doesn't change that rundown.
  await rg.goto(templateUrl);
  await columnMenu(rg, 'Headline', 'Remove This Column');
  await rg.getByRole('button', { name: '+ Section' }).click();
  await rg.getByLabel('A2 slug').fill('Added Later');
  await rg.getByLabel('A2 slug').press('Enter');
  await expect.poll(() => headings(rg)).not.toContain('Headline');
  await rg.goto(episodeUrl);
  await expect(rg.getByRole('link', { name: 'Open the script for A1 Show Open' })).toBeVisible();
  await expect(rg.locator('tr.section-row')).toHaveCount(1);
  await expect.poll(() => headings(rg)).toContain('Headline');
});
