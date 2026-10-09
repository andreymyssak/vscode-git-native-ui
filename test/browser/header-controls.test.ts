import { expect, test } from '@playwright/test';

test('hiding branches keeps the search draft, scope and preferred width through reload', async ({
  page,
}) => {
  await page.goto('/');
  const branches = page.locator('#branch-pane');
  const search = page.getByRole('searchbox', { name: 'Branch or tag' });
  const before = (await branches.boundingBox())!.width;

  await search.fill('topic');
  const requests = await page.evaluate(() => window.__requests.length);

  await page.getByRole('button', { name: 'Hide Git Branches' }).click();
  await expect(search).toBeHidden();
  await expect(
    page.getByRole('separator', { name: 'Resize branches' }),
  ).toHaveCount(0);
  expect((await branches.boundingBox())!.width).toBe(30);
  expect(await page.evaluate(() => window.__requests.length)).toBe(requests);
  await page.getByRole('separator', { name: 'Resize details' }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: 'Show Git Branches' }).click();
  await expect(search).toHaveValue('topic');
  expect((await branches.boundingBox())!.width).toBe(before);
  await page.getByRole('button', { name: 'Hide Git Branches' }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Show Git Branches' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show Git Branches' }).click();
  expect((await branches.boundingBox())!.width).toBe(before);
});

test('the whole collapsed branch rail reopens with a pointer or keyboard', async ({
  page,
}) => {
  await page.goto('/');
  const hide = page.getByRole('button', { name: 'Hide Git Branches' });
  const show = page.getByRole('button', { name: 'Show Git Branches' });
  const search = page.getByRole('searchbox', { name: 'Branch or tag' });
  const pane = page.locator('#branch-pane');

  await hide.click();
  const box = (await pane.boundingBox())!;

  // The strip's empty bottom area must be just as clickable as its chevron.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12);
  await expect(search).toBeVisible();
  await hide.click();
  const label = pane.getByText('Branches', { exact: true });

  await expect(label).toHaveCSS('user-select', 'none');
  await label.click();
  await expect(search).toBeVisible();
  for (const key of ['Enter', 'Space']) {
    await hide.click();
    await show.focus();
    await page.keyboard.press(key);
    await expect(search).toBeVisible();
  }
});

test('both search inputs use matching compact icons without blocking input focus', async ({
  page,
}) => {
  await page.goto('/');
  for (const [name, selector] of [
    ['Branch or tag', '#branch-search .codicon-search'],
    ['Text or hash', '#search-controls .codicon-search'],
  ] as const) {
    const input = page.getByRole('searchbox', { name });
    const icon = page.locator(selector);
    const inputBox = (await input.boundingBox())!;

    await expect(icon).toHaveCSS('font-size', '14px');
    const iconBox = (await icon.boundingBox())!;

    expect(iconBox.width).toBe(14);
    expect(iconBox.height).toBe(14);
    expect(iconBox.x - inputBox.x).toBe(6);
    expect(iconBox.y + iconBox.height / 2).toBe(
      inputBox.y + inputBox.height / 2,
    );
    await expect(input).toHaveCSS('padding-left', '26px');
    await input.click({ position: { x: 12, y: inputBox.height / 2 } });
    await expect(input).toBeFocused();
  }

  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Regular expression' }),
  ).toBeFocused();
});

test('filter controls share dimensions and clear inside their borders without shifting neighbors', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto('/');
  const user = page.getByRole('button', { name: 'User filter', exact: true });
  const date = page.getByRole('button', { name: 'Date filter', exact: true });
  const userControl = user.locator('..');
  const dateControl = date.locator('..');
  const before = await dateControl.boundingBox();

  await user.click();
  await page.getByRole('button', { name: 'Me', exact: true }).click();
  expect(await dateControl.boundingBox()).toEqual(before);
  await date.click();
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  const userBox = (await userControl.boundingBox())!;
  const dateBox = (await dateControl.boundingBox())!;

  expect(userBox.height).toBe(dateBox.height);
  for (const [control, label] of [
    [userControl, 'Clear user filter'],
    [dateControl, 'Clear date filter'],
  ] as const) {
    const box = (await control.boundingBox())!;
    const clear = page.getByRole('button', { name: label });
    const clearBox = (await clear.boundingBox())!;

    expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(box.x + box.width);
    await clear.click();
    expect(await control.boundingBox()).toEqual(box);
  }

  await expect(user).toHaveText('User');
  await expect(date).toHaveText('Date');
  await page.screenshot({ path: '.artifacts/header-controls-expanded.png' });
  await page.getByRole('button', { name: 'Hide Git Branches' }).click();
  await page.screenshot({ path: '.artifacts/header-controls-collapsed.png' });
});

for (const path of ['/', '/development.html'])
  test(`Reveal single click preserves the log, double click opens current branch history, ${path}`, async ({
    page,
  }) => {
    await page.goto(path);
    await page.getByRole('treeitem', { name: 'topic', exact: true }).dblclick();
    await expect(page.locator('#scope')).toHaveText('topic');
    const reveal = page.getByRole('button', {
      name: 'Reveal Current Branch',
      exact: true,
    });
    const before = await page.evaluate(() => window.__requests.length);

    await reveal.click();
    expect(await page.evaluate(() => window.__requests.length)).toBe(before);
    await expect(page.locator('#scope')).toHaveText('topic');
    await reveal.dblclick();
    await expect(page.locator('#scope')).toHaveText('main');
    const requests = (await page.evaluate(() => window.__requests)).slice(
      before,
    );

    expect(requests.filter(({ body }) => body.kind === 'history')).toHaveLength(
      1,
    );
    expect(requests.filter(({ body }) => body.kind === 'action')).toHaveLength(
      0,
    );
    await expect(
      page.getByRole('treeitem', {
        name: 'main (Current branch)',
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true');
  });

test('Fetch is an explicit repository action in Branches while Refresh rereads local history', async ({
  page,
}) => {
  await page.goto('/');
  const branches = page.getByRole('toolbar', {
    name: 'Branch actions',
    exact: true,
  });

  await branches
    .getByRole('button', { name: 'Fetch All Remotes', exact: true })
    .click();
  expect((await page.evaluate(() => window.__requests)).at(-1)?.body).toEqual({
    kind: 'action',
    action: { kind: 'fetch-all' },
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect((await page.evaluate(() => window.__requests)).at(-1)?.body).toEqual({
    kind: 'refresh',
  });
});

test('repository selection is only offered when the workspace has multiple Git repositories', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#repository')).toHaveCount(0);
  await page.goto('/?multiple');
  const selector = page.getByRole('button', {
    name: 'Select repository',
    exact: true,
  });

  await expect(selector).toContainText('Example repository');
  await selector.click();
  expect((await page.evaluate(() => window.__requests)).at(-1)?.body).toEqual({
    kind: 'choose-repository',
  });
});

test('Log tab owns repository and actual history scope while Worktrees is active', async ({
  page,
}) => {
  await page.goto('/');
  const log = page.getByRole('tab', { name: 'Log', exact: true });

  await expect(log).toHaveText('Log: main');
  await page.getByRole('treeitem', { name: 'topic', exact: true }).click();
  await expect(log).toHaveText('Log: main');
  await page.getByRole('treeitem', { name: 'topic', exact: true }).dblclick();
  await expect(log).toHaveText('Log: topic');
  await expect(log.locator('#scope')).toHaveText('topic');
  await page.getByRole('tab', { name: 'Worktrees', exact: true }).click();
  await expect(log).toHaveText('Log: topic');
  await page.reload();
  await expect(
    page.getByRole('tab', { name: 'Worktrees', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(log).toHaveText('Log: topic');
  await log.click();
  await expect(page.locator('#scope')).toHaveText('topic');
});
