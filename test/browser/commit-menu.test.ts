import { expect, test } from '@playwright/test';

test('right-click exposes the clicked commit in native context without dispatching an action', async ({
  page,
}) => {
  await page.goto('/');
  const row = page.locator('[data-commit-row]').nth(1);

  await row.click({ button: 'right' });
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(row).toBeFocused();
  expect(
    JSON.parse((await row.getAttribute('data-vscode-context')) ?? '{}'),
  ).toMatchObject({
    webviewSection: 'commit',
    gitNativeUIRepositoryId: 'one',
    gitNativeUICommitSha: '2'.padStart(40, '0'),
    gitNativeUIGeneration: 1,
    gitNativeUICommitCanEdit: false,
    gitNativeUICommitCanCherryPick: true,
    preventDefaultContextMenuItems: true,
  });
  expect(
    (await page.evaluate(() => window.__requests)).filter(
      (request) => request.body.kind === 'action',
    ),
  ).toHaveLength(0);
});

test('keyboard menu retains row focus and enables editing unpublished history', async ({
  page,
}) => {
  await page.goto('/');
  const row = page.locator('[data-commit-row]').first();

  await row.focus();
  await row.press('Shift+F10');
  await expect(row).toBeFocused();
  const context = JSON.parse(
    (await row.getAttribute('data-vscode-context')) ?? '{}',
  );

  expect(context.gitNativeUICommitSha).toBe('1'.padStart(40, '0'));
  expect(context.gitNativeUICommitCanEdit).toBe(false); // This fixture's tip is also on origin/main.
  await page.evaluate(() => {
    const request = window.__requests.at(-1)!;

    window.__deliver({
      ...request,
      body: {
        kind: 'history',
        append: false,
        scope: { kind: 'head' },
        text: '',
        repository: {
          id: 'one',
          label: 'Example',
          rootUri: 'file:///example',
          branch: 'main',
          headSha: '1'.padStart(40, '0'),
        },
        page: {
          commits: [
            {
              sha: '1'.padStart(40, '0'),
              parents: [],
              message: 'Local tip',
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
  });
  const local = JSON.parse(
    (await row.getAttribute('data-vscode-context')) ?? '{}',
  );

  expect(local.gitNativeUICommitCanEdit).toBe(true);
});
test('native context and selection are current before the menu event reaches the window', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Text or hash' }).fill('query');
  await page.getByRole('searchbox', { name: 'Text or hash' }).press('Enter');
  await expect(page.locator('#history-pane')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await page.evaluate(() =>
    window.addEventListener('contextmenu', (event) => {
      const row = (event.target as HTMLElement).closest('[data-commit-row]');

      Reflect.set(window, 'observedNativeContext', {
        context: JSON.parse(row?.getAttribute('data-vscode-context') ?? '{}'),
        selected: row?.getAttribute('aria-selected'),
      });
    }),
  );
  const row = page.locator('[data-commit-row]').nth(1);

  await row.click({ button: 'right' });
  expect(
    await page.evaluate(() => Reflect.get(window, 'observedNativeContext')),
  ).toMatchObject({
    selected: 'true',
    context: {
      gitNativeUIRepositoryId: 'one',
      gitNativeUIGeneration: 2,
      gitNativeUICommitSha: '2'.padStart(40, '0'),
      gitNativeUICommitCanEdit: false,
      gitNativeUICommitCanCherryPick: true,
    },
  });
  await row.press('Shift+F10');
  expect(
    await page.evaluate(() => Reflect.get(window, 'observedNativeContext')),
  ).toMatchObject({
    selected: 'true',
    context: { gitNativeUICommitSha: '2'.padStart(40, '0') },
  });
});

test('native squash context reflects the full range on every selected row and updates before pointer or keyboard menus', async ({
  page,
}) => {
  await page.goto('/');
  const rows = page.locator('[data-commit-row]');
  const sha = (number: number) => number.toString(16).padStart(40, '0');

  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ['Shift'] });
  expect(
    JSON.parse((await rows.nth(0).getAttribute('data-vscode-context')) ?? '{}')
      .gitNativeUICommitCanSquash,
  ).toBe(false);
  await page.evaluate(() => {
    const request = window.__requests.at(-1)!;

    window.__deliver({
      ...request,
      body: { kind: 'references', references: [] },
    });
    window.addEventListener('contextmenu', (event) => {
      const row = (event.target as HTMLElement).closest('[data-commit-row]');

      Reflect.set(
        window,
        'observedSquashContext',
        JSON.parse(row?.getAttribute('data-vscode-context') ?? '{}'),
      );
    });
  });
  for (const index of [0, 1])
    expect(
      JSON.parse(
        (await rows.nth(index).getAttribute('data-vscode-context')) ?? '{}',
      ),
    ).toMatchObject({
      gitNativeUICommitShas: [sha(1), sha(2)],
      gitNativeUICommitSelectionCount: 2,
      gitNativeUICommitCanSquash: true,
      gitNativeUICommitCanDrop: true,
      gitNativeUICommitCanEdit: false,
      gitNativeUICommitCanCherryPick: true,
    });
  await rows.nth(0).click({ button: 'right' });
  expect(
    await page.evaluate(() => Reflect.get(window, 'observedSquashContext')),
  ).toMatchObject({
    gitNativeUICommitSha: sha(1),
    gitNativeUICommitShas: [sha(1), sha(2)],
    gitNativeUICommitCanSquash: true,
  });
  expect((await page.evaluate(() => window.__requests)).at(-1)?.body).toEqual({
    kind: 'select-commits',
    shas: [sha(1), sha(2)],
    activeSha: sha(1),
  });
  await rows.nth(0).press('Shift+F10');
  expect(
    await page.evaluate(() => Reflect.get(window, 'observedSquashContext')),
  ).toMatchObject({
    gitNativeUICommitSha: sha(1),
    gitNativeUICommitShas: [sha(1), sha(2)],
    gitNativeUICommitCanSquash: true,
  });
  await rows.nth(2).click({ button: 'right' });
  expect(
    await page.evaluate(() => Reflect.get(window, 'observedSquashContext')),
  ).toMatchObject({
    gitNativeUICommitSha: sha(3),
    gitNativeUICommitShas: [sha(3)],
    gitNativeUICommitSelectionCount: 1,
    gitNativeUICommitCanSquash: false,
    gitNativeUICommitCanCherryPick: true,
  });
});

test('older message edits and squash use linear ancestry while Drop keeps suffix scope', async ({
  page,
}) => {
  await page.goto('/');
  const rows = page.locator('[data-commit-row]');

  await expect(rows.first()).toBeVisible();
  const context = JSON.parse(
    (await rows.first().getAttribute('data-vscode-context'))!,
  ) as { gitNativeUIGeneration: number; gitNativeUIRepositoryId: string };

  await page.evaluate((current) => {
    window.__deliver({
      requestId: 'unpublished-fixture',
      repositoryId: current.gitNativeUIRepositoryId,
      generation: current.gitNativeUIGeneration,
      body: { kind: 'references', references: [] },
    });
  }, context);

  await rows.nth(2).click({ button: 'right' });
  expect(
    JSON.parse((await rows.nth(2).getAttribute('data-vscode-context'))!),
  ).toMatchObject({ gitNativeUICommitCanEdit: true });
  await rows.nth(2).click();
  await rows.nth(4).click({ modifiers: ['Shift'] });
  expect(
    JSON.parse((await rows.nth(2).getAttribute('data-vscode-context'))!),
  ).toMatchObject({
    gitNativeUICommitCanSquash: true,
    gitNativeUICommitCanDrop: false,
  });
});
