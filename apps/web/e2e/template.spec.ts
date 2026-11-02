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

const headings = (page: Page) => page.locator('table.rundown thead th').allTextContents();
/** A column's line in the template's Columns box, by its exact name. */
const columnLine = (page: Page, name: string) => page.locator('.columns-list li', { has: page.getByText(name, { exact: true }) });

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

  // The template: a Show Open section with the Show Intro, and its script.
  await rg.getByLabel('A1 slug').fill('Show Open');
  await rg.getByLabel('A1 slug').press('Enter');
  await rg.getByRole('button', { name: 'Add a graphic to A1' }).click();
  await rg.getByRole('menuitem', { name: /Show Intro/ }).click();
  await rg.getByRole('link', { name: 'Open the script for A1 Show Open' }).click();
  const script = rg.getByRole('textbox', { name: 'Script for A1' });
  await script.locator('p').last().click();
  await rg.keyboard.type('Good evening and welcome.');
  await rg.keyboard.press('Escape');
  await rg.goto(templateUrl);

  // Columns: Writer is hidden, Notes moves up above Story Type. Slug, Camera and Graphics can't be hidden.
  await columnLine(rg, 'Writer').getByRole('button', { name: 'Hide' }).click();
  for (let i = 0; i < 5; i++) {
    if ((await headings(rg)).indexOf('Notes') === 2) break;
    await rg.getByRole('button', { name: 'Move Notes up' }).click();
  }
  for (const locked of ['Slug', 'Camera', 'Graphics']) await expect(columnLine(rg, locked).getByRole('button', { name: 'Hide' })).toHaveCount(0);
  await expect.poll(() => headings(rg)).toEqual(['', '#', 'Slug', 'Notes', 'Story Type', 'Talent', 'Camera', 'Headline', 'Graphics', 'Assign Graphics', 'Est.', 'Back-time', 'Last edit']);

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

  // Changing the template afterward doesn't change that rundown.
  await rg.goto(templateUrl);
  await columnLine(rg, 'Headline').getByRole('button', { name: 'Hide' }).click();
  await rg.getByRole('button', { name: '+ Section' }).click();
  await rg.getByLabel('A2 slug').fill('Added Later');
  await rg.getByLabel('A2 slug').press('Enter');
  await expect.poll(() => headings(rg)).not.toContain('Headline');
  await rg.goto(episodeUrl);
  await expect(rg.getByRole('link', { name: 'Open the script for A1 Show Open' })).toBeVisible();
  await expect(rg.locator('tr.section-row')).toHaveCount(1);
  await expect.poll(() => headings(rg)).toContain('Headline');
});
