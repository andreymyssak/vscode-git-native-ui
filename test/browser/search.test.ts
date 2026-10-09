import { expect, test } from '../fixtures/browser';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});
test('typing does not query', async ({ page }) => {
  await page.getByLabel('Text or hash').fill('hello');
  expect(
    (await page.evaluate(() => window.__requests)).filter(
      (r) => r.body.kind === 'history',
    ),
  ).toHaveLength(0);
});
test('Enter and blur apply once', async ({ page }) => {
  await page.getByLabel('Text or hash').fill('hello');
  await page.getByLabel('Text or hash').press('Enter');
  await page.getByRole('button', { name: 'Refresh', exact: true }).focus();
  expect(
    (await page.evaluate(() => window.__requests)).filter(
      (r) => r.body.kind === 'history',
    ),
  ).toHaveLength(1);
});
test('hash mode labels All and restores remembered scope', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'topic', exact: true }).dblclick();
  await page.getByLabel('Text or hash').fill('abcdef0');
  await page.getByLabel('Text or hash').press('Enter');
  await expect(page.locator('#scope')).toContainText('All branches search');
  await page.getByLabel('Text or hash').fill('');
  await page.getByLabel('Text or hash').press('Enter');
  await expect(page.locator('#scope')).toHaveText('topic');
});
