import { expect, test } from '../fixtures/browser';
import { loadHistoryPages } from './history-paging';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});
test('single branch click only selects', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'topic', exact: true }).click();
  const requests = await page.evaluate(() => window.__requests);

  expect(
    requests.filter((request) => request.body.kind === 'history'),
  ).toHaveLength(0);
  expect(
    requests.filter((request) => request.body.kind === 'action'),
  ).toHaveLength(0);
});
test('double click and Enter apply history without checkout', async ({
  page,
}) => {
  await page.getByRole('treeitem', { name: 'topic', exact: true }).dblclick();
  await expect(page.locator('#scope')).toContainText('topic');
  await page
    .getByRole('treeitem', { name: 'main (Current branch)', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#scope')).toContainText('main');
  const requests = await page.evaluate(() => window.__requests);

  expect(
    requests.filter((request) => request.body.kind === 'action'),
  ).toHaveLength(0);
});
test('ref groups and folders have keyboard focus', async ({ page }) => {
  for (const name of ['Local', 'Remote', 'Tags', 'feature'])
    await expect(
      page.getByRole('treeitem', { name, exact: true }),
    ).toBeVisible();
  await page.getByRole('treeitem', { name: 'feature', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('treeitem', { name: 'nested', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('treeitem', { name: 'nested', exact: true }),
  ).toBeFocused();
});
test('commit details render repository text literally and preserve fixed history-row geometry', async ({
  page,
}) => {
  const count = await page.locator('[data-commit-row]').count();

  await page.locator('[data-commit-row]').first().click();
  await expect(page.locator('#details')).toContainText('<img src=x');
  expect(await page.locator('[data-commit-row]').count()).toBe(count);
  await expect(page.locator('#details img')).toHaveCount(0);
  const row = page.locator('[data-commit-row]').first();
  const box = await row.boundingBox();
  const svgBox = await row.locator('svg').boundingBox();

  expect(svgBox?.height).toBe(22);
  expect(box?.height).toBe(22);
  await expect(row.locator('svg path').first()).toHaveCSS(
    'stroke',
    'rgb(255, 176, 0)',
  );
});
test('ten pages mount at most 300 rows', async ({ page }) => {
  await loadHistoryPages(page, 10);
  const count = await page.locator('[data-commit-row]').count();

  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(300);
});

test('actual startup sequence retains multiple repository choices', async ({
  page,
}) => {
  await page.goto('/?multiple');
  await expect(page.locator('#repository')).toBeEnabled();
  await page.locator('#repository').click();
  expect((await page.evaluate(() => window.__requests)).at(-1)?.body.kind).toBe(
    'choose-repository',
  );
});
