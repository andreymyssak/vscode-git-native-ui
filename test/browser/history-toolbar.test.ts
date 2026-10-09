import { expect, test } from '../fixtures/browser';

test('filters are sent together, native author results apply once, and revision visibility survives reopening', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'User filter', exact: true }).click();
  await page.getByRole('button', { name: 'Me', exact: true }).click();
  await page.getByRole('button', { name: 'Date filter', exact: true }).click();
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await page.getByRole('button', { name: 'Regular expression' }).click();
  await page.getByRole('button', { name: 'Match case' }).click();
  expect(
    (await page.evaluate(() => window.__requests)).at(-1)?.body,
  ).toMatchObject({
    kind: 'history',
    filters: {
      regex: true,
      matchCase: true,
      author: { kind: 'me' },
      date: '7d',
    },
  });
  await page.getByRole('button', { name: 'User filter', exact: true }).click();
  await page.getByRole('button', { name: 'Select users…' }).click();
  expect((await page.evaluate(() => window.__requests)).at(-1)?.body.kind).toBe(
    'choose-authors',
  );
  await page.evaluate(() => {
    const request = window.__requests.at(-1)!;

    window.__deliver({
      ...request,
      body: {
        kind: 'filters',
        filters: {
          regex: true,
          matchCase: true,
          date: '7d',
          author: {
            kind: 'selected',
            identities: [{ name: 'Alice', email: 'alice@example.test' }],
          },
        },
      },
    });
  });
  await expect(
    page.getByRole('button', { name: 'User filter', exact: true }),
  ).toHaveText('Alice');
  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('button', { name: 'Columns', exact: true }).hover();
  await page.getByRole('checkbox', { name: 'Hash' }).check();
  await page.keyboard.press('Escape');
  const revision = page.locator('[data-revision]').first();

  await expect(revision).toHaveText('00000000');
  await expect(revision).toHaveAttribute('title', '1'.padStart(40, '0'));
  const beforeWidth = (await revision.boundingBox())!.width;
  const revisionDivider = page.getByRole('separator', {
    name: 'Resize Date and Revision columns',
  });

  await revisionDivider.focus();
  await page.keyboard.press('ArrowLeft');
  const resizedWidth = (await revision.boundingBox())!.width;

  expect(resizedWidth).toBeCloseTo(beforeWidth + 10, 1);
  await page.reload();
  await expect(page.locator('[data-revision]').first()).toBeVisible();
  expect(
    (await page.locator('[data-revision]').first().boundingBox())!.width,
  ).toBeCloseTo(resizedWidth, 1);
  await expect(
    page.getByRole('button', { name: 'User filter', exact: true }),
  ).toHaveText('Alice');
  await expect(
    page.getByRole('button', { name: 'Match case' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '.artifacts/history-toolbar-preview.png' });
});
