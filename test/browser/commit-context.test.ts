import { expect, test } from '../fixtures/browser';

test('commit context uses full identities and disables merge or detached cherry pick', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('[data-commit-row]').first().click();
  const row = page.locator('[data-commit-row]').first();
  const context = async () =>
    JSON.parse((await row.getAttribute('data-vscode-context'))!);

  await row.click({ button: 'right' });
  expect(await context()).toMatchObject({
    gitNativeUICommitSha: '1'.padStart(40, '0'),
    gitNativeUICommitShas: ['1'.padStart(40, '0')],
    gitNativeUICommitCanCherryPick: true,
  });
  await page.evaluate(() => {
    const r = window.__requests.at(-1)!;

    window.__deliver({
      ...r,
      body: {
        kind: 'details',
        commit: {
          sha: '1'.padStart(40, '0'),
          parents: ['a'.repeat(40), 'b'.repeat(40)],
          message: 'Merge',
          authorName: null,
          authorEmail: null,
          authorDate: null,
          commitDate: null,
        },
      },
    });
  });
  await expect
    .poll(context)
    .toMatchObject({ gitNativeUICommitCanCherryPick: false });
  await page.reload();
  await expect(row).toBeVisible();
  const generation = (await context()).gitNativeUIGeneration as number;

  await page.evaluate((generation) => {
    const request = window.__requests.at(-1)!;
    const sha = '1'.padStart(40, '0');

    window.__deliver({
      ...request,
      generation,
      body: {
        kind: 'history',
        repository: {
          id: 'one',
          label: 'Example repository',
          rootUri: 'file:///example',
          headSha: sha,
          branch: null,
        },
        scope: { kind: 'all' },
        text: '',
        append: false,
        page: {
          commits: [
            {
              sha,
              parents: [],
              message: 'Detached',
              authorName: null,
              authorEmail: null,
              authorDate: null,
              commitDate: null,
            },
          ],
          refs: [],
          nextCursor: null,
          scopeId: 'fixture',
        },
      },
    });
  }, generation);
  await row.click({ button: 'right' });
  await expect
    .poll(context)
    .toMatchObject({ gitNativeUICommitCanCherryPick: false });
});

test('Shift selection supplies every full commit identity to the native menu', async ({
  page,
}) => {
  await page.goto('/');
  const rows = page.locator('[data-commit-row]');

  await rows.first().click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  await rows.nth(1).click({ button: 'right' });
  const context = JSON.parse(
    (await rows.nth(1).getAttribute('data-vscode-context'))!,
  );

  expect(context).toMatchObject({
    gitNativeUICommitSha: '2'.padStart(40, '0'),
    gitNativeUICommitShas: ['1'.padStart(40, '0'), '2'.padStart(40, '0')],
    gitNativeUICommitSelectionCount: 2,
    gitNativeUICommitCanCherryPick: true,
  });
});
