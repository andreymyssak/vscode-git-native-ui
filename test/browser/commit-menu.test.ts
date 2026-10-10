import { expect, test } from '../fixtures/browser';

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
    repositoryId: 'one',
    commitSha: '2'.padStart(40, '0'),
    generation: 1,
    commitCanEdit: false,
    commitCanCherryPick: true,
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

  expect(context.commitSha).toBe('1'.padStart(40, '0'));
  expect(context.commitCanEdit).toBe(false); // This fixture's tip is also on origin/main.
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

  expect(local.commitCanEdit).toBe(true);
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
      repositoryId: 'one',
      generation: 2,
      commitSha: '2'.padStart(40, '0'),
      commitCanEdit: false,
      commitCanCherryPick: true,
    },
  });
  await row.press('Shift+F10');
  expect(
    await page.evaluate(() => Reflect.get(window, 'observedNativeContext')),
  ).toMatchObject({
    selected: 'true',
    context: { commitSha: '2'.padStart(40, '0') },
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
      .commitCanSquash,
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
      commitShas: [sha(1), sha(2)],
      commitSelectionCount: 2,
      commitCanSquash: true,
      commitCanDrop: true,
      commitCanEdit: false,
      commitCanCherryPick: true,
    });
  await rows.nth(0).click({ button: 'right' });
  expect(
    await page.evaluate(() => Reflect.get(window, 'observedSquashContext')),
  ).toMatchObject({
    commitSha: sha(1),
    commitShas: [sha(1), sha(2)],
    commitCanSquash: true,
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
    commitSha: sha(1),
    commitShas: [sha(1), sha(2)],
    commitCanSquash: true,
  });
  await rows.nth(2).click({ button: 'right' });
  expect(
    await page.evaluate(() => Reflect.get(window, 'observedSquashContext')),
  ).toMatchObject({
    commitSha: sha(3),
    commitShas: [sha(3)],
    commitSelectionCount: 1,
    commitCanSquash: false,
    commitCanCherryPick: true,
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
  ) as { generation: number; repositoryId: string };

  await page.evaluate((current) => {
    window.__deliver({
      requestId: 'unpublished-fixture',
      repositoryId: current.repositoryId,
      generation: current.generation,
      body: { kind: 'references', references: [] },
    });
  }, context);

  await rows.nth(2).click({ button: 'right' });
  expect(
    JSON.parse((await rows.nth(2).getAttribute('data-vscode-context'))!),
  ).toMatchObject({ commitCanEdit: true });
  await rows.nth(2).click();
  await rows.nth(4).click({ modifiers: ['Shift'] });
  expect(
    JSON.parse((await rows.nth(2).getAttribute('data-vscode-context'))!),
  ).toMatchObject({
    commitCanSquash: true,
    commitCanDrop: false,
  });
});
