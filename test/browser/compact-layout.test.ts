import { expect, test } from '../fixtures/browser';

test('changed files stay clickable in a short panel with a long commit message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 280 });
  await page.goto('/');
  await page.locator('[data-commit-row]').first().click();
  await page.evaluate(() => {
    const request = window.__requests.at(-1)!;
    const sha = '1'.padStart(40, '0');

    window.__deliver({
      ...request,
      body: {
        kind: 'details',
        commit: {
          sha,
          parents: ['a'.repeat(40)],
          message: 'Long commit\n' + 'A detailed explanation.\n'.repeat(80),
          authorName: 'Fixture author',
          authorEmail: 'fixture@example.test',
          authorDate: '2026-10-04T00:00:00Z',
          commitDate: '2026-10-04T00:00:00Z',
        },
      },
    });
    window.__deliver({
      ...request,
      body: {
        kind: 'files',
        sha,
        parentSha: 'a'.repeat(40),
        files: [
          {
            id: 'visible-file',
            status: 'modified',
            oldPath: 'sample.txt',
            newPath: 'sample.txt',
          },
        ],
      },
    });
  });
  const file = page.getByRole('treeitem', { name: /Modified.*sample.txt/ });

  await expect(file).toBeInViewport({ ratio: 1 });
  await file.click();
  await expect
    .poll(
      async () => (await page.evaluate(() => window.__requests)).at(-1)?.body,
    )
    .toEqual({
      kind: 'open-file',
      fileId: 'visible-file',
      preview: true,
    });
});

test('history columns fit beside both panes in a narrow window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 280 });
  await page.goto('/');
  const history = await page.locator('#history').boundingBox();

  expect(history).not.toBeNull();
  for (const column of ['[data-subject]', '[data-author]', '[data-date]']) {
    const cell = page.locator('[data-commit-row]').first().locator(column);

    await expect(cell).toBeInViewport({ ratio: 1 });
    const box = (await cell.boundingBox())!;

    expect(box.x + box.width).toBeLessThanOrEqual(history!.x + history!.width);
  }
});

for (const width of [620, 720])
  test(`search and history controls remain usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 280 });
    await page.goto('/');
    const search = page.getByRole('searchbox', { name: 'Text or hash' });
    const author = page.getByRole('button', {
      name: 'User filter',
      exact: true,
    });
    const date = page.getByRole('button', { name: 'Date filter', exact: true });

    for (const field of [search, author, date]) {
      await expect(field).toBeInViewport({ ratio: 1 });
      expect((await field.boundingBox())!.width).toBeGreaterThanOrEqual(72);
    }

    await search.fill('sample');
    await search.press('Enter');
    await expect(search).toHaveValue('sample');
    await page.locator('[data-commit-row]').first().click();
    await expect(
      page.getByRole('button', {
        name: 'Refresh',
        exact: true,
      }),
    ).toBeInViewport({ ratio: 1 });
    const details = (await page.locator('#details').boundingBox())!;

    expect(details.x + details.width).toBeLessThanOrEqual(width);
  });

test('User and Date have consistent dropdown surfaces and aligned compact chevrons', async ({
  page,
}) => {
  await page.goto('/');
  const author = page.getByRole('button', { name: 'User filter', exact: true });
  const date = page.getByRole('button', { name: 'Date filter', exact: true });
  const surface = (node: HTMLElement) => {
    const style = getComputedStyle(node);

    return [
      node.getBoundingClientRect().height,
      style.backgroundColor,
      style.border,
      style.borderRadius,
      style.paddingLeft,
      style.paddingTop,
      style.paddingBottom,
      style.color,
    ];
  };

  expect(await author.evaluate(surface)).toEqual(await date.evaluate(surface));
  await expect(author).toHaveCSS('appearance', 'none');
  const authorChevron = author.locator('..').locator('.codicon-chevron-down');
  const dateChevron = date.locator('.codicon-chevron-down');

  await expect(authorChevron).toBeVisible();
  expect((await authorChevron.boundingBox())!.y).toBe(
    (await dateChevron.boundingBox())!.y,
  );
  await author.click();
  await page.getByRole('button', { name: 'Me', exact: true }).click();
  await expect(author).toHaveText('Me');
  await date.click();
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect(date).toHaveText('Last 7 days');
});

test('the checked-out branch stays identifiable with a long branch name', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 280 });
  await page.goto('/');
  await page.evaluate(() => {
    const request = window.__requests.at(-1)!;
    const branch = 'feature/current-branch-with-a-very-long-name';
    const sha = '1'.padStart(40, '0');

    window.__deliver({
      ...request,
      generation: 1,
      body: {
        kind: 'history',
        append: false,
        text: '',
        scope: { kind: 'head' },
        repository: {
          id: 'one',
          label: 'Example repository',
          rootUri: 'file:///example',
          headSha: sha,
          branch,
        },
        page: {
          commits: [
            {
              sha,
              parents: [],
              message: 'A readable commit',
              authorName: 'Fixture author',
              authorEmail: null,
              authorDate: null,
              commitDate: null,
            },
          ],
          refs: [
            {
              id: 'refs/heads/' + branch,
              name: branch,
              kind: 'local',
              sha,
              remote: null,
            },
          ],
          nextCursor: null,
          scopeId: 'fixture',
        },
      },
    });
  });
  await page.getByRole('treeitem', { name: 'feature', exact: true }).click();
  const branch = page.getByRole('treeitem', {
    name: /current-branch-with-a-very-long-name.*Current branch/,
  });

  await expect(branch).toBeInViewport({ ratio: 1 });
  const icon = branch.locator('[slot="icon-leaf"]');

  await expect(icon).toBeVisible();
  const iconBox = (await icon.boundingBox())!;
  const nameBox = (await branch
    .locator('[data-reference-name]')
    .boundingBox())!;

  expect(iconBox.width).toBe(16);
  expect(nameBox.width).toBeGreaterThanOrEqual(40);
  const branchBox = (await branch.boundingBox())!;

  expect(iconBox.x).toBeGreaterThanOrEqual(branchBox.x);
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
    branchBox.x + branchBox.width,
  );
});

test('a branching graph leaves readable messages and scrollable history columns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 280 });
  await page.goto('/');
  await page.evaluate(() => {
    const request = window.__requests.at(-1)!;
    const identity = (value: number) => value.toString(16).padStart(40, '0');
    const record = (value: number, parents: number[], message: string) => ({
      sha: identity(value),
      parents: parents.map(identity),
      message,
      authorName: 'Fixture author',
      authorEmail: null,
      authorDate: null,
      commitDate: '2026-10-04T00:00:00Z',
    });

    window.__deliver({
      ...request,
      generation: 1,
      body: {
        kind: 'history',
        append: false,
        scope: { kind: 'all' },
        text: '',
        repository: {
          id: 'one',
          label: 'Example repository',
          rootUri: 'file:///example',
          headSha: identity(100),
          branch: 'main',
        },
        page: {
          commits: [
            ...Array.from({ length: 20 }, (_, i) =>
              record(i + 100, [i + 200], `Branch tip ${i}`),
            ),
            ...Array.from({ length: 20 }, (_, i) =>
              record(i + 200, [999], `Branch ancestor ${i}`),
            ),
            record(999, [], 'Root'),
          ],
          refs: [],
          nextCursor: null,
          scopeId: 'fixture',
        },
      },
    });
  });
  const message = page
    .locator('[data-commit-row]')
    .first()
    .locator('[data-subject-message]');

  expect((await message.boundingBox())!.width).toBeGreaterThanOrEqual(100);
  const history = page.locator('#history');
  const extent = await history.evaluate((node) => ({
    width: node.clientWidth,
    scroll: node.scrollWidth,
  }));

  expect(extent.scroll).toBeGreaterThan(extent.width);
  await history.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  await expect(
    page.locator('[data-commit-row]').first().locator('[data-date]'),
  ).toBeInViewport({ ratio: 1 });
});

test('restored oversized panes resize immediately from their visible divider', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 280 });
  await page.goto('/');
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('git-ui-native-state')!);

    saved.paneWidths = [600, 350];
    sessionStorage.setItem('git-ui-native-state', JSON.stringify(saved));
  });
  await page.reload();
  const branches = page.locator('#branch-pane');
  const divider = page.getByRole('separator', { name: 'Resize branches' });
  const before = (await branches.boundingBox())!.width;

  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  const afterKey = (await branches.boundingBox())!.width;

  expect(before - afterKey).toBeGreaterThanOrEqual(9);
  const handle = (await divider.boundingBox())!;

  await page.mouse.move(handle.x + handle.width / 2, handle.y + 20);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 100, handle.y + 20);
  await page.mouse.up();
  expect(
    afterKey - (await branches.boundingBox())!.width,
  ).toBeGreaterThanOrEqual(90);
  const details = (await page.locator('#details').boundingBox())!;

  expect(details.x + details.width).toBeLessThanOrEqual(960);
});

test('branches can expand into available history space', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 280 });
  await page.goto('/');
  const branches = page.locator('#branch-pane');
  const before = (await branches.boundingBox())!.width;
  const divider = (await page
    .getByRole('separator', { name: 'Resize branches' })
    .boundingBox())!;

  await page.mouse.move(divider.x + 2, divider.y + 20);
  await page.mouse.down();
  await page.mouse.move(divider.x + 102, divider.y + 20);
  await page.mouse.up();
  expect((await branches.boundingBox())!.width - before).toBeGreaterThanOrEqual(
    90,
  );
});
