import { expect, test } from '../fixtures/browser';

test('browser reload restores identifiers, widths and active view without caching contents', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('treeitem', { name: 'topic', exact: true }).dblclick();
  await page.getByRole('separator', { name: 'Resize branches' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tab', { name: 'Worktrees', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('tab', { name: 'Worktrees', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Log', exact: true }).click();
  await expect(page.locator('#scope')).toHaveText('topic');
  await expect(page.locator('#log-view')).toHaveCSS(
    'grid-template-columns',
    /230px/,
  );
});

for (const route of ['/', '/development.html']) {
  test(`startup Git refresh preserves the saved commit and details on ${route}`, async ({
    page,
  }) => {
    const sha = '2'.padStart(40, '0');
    const parentSha = '3'.padStart(40, '0');

    await page.addInitScript(
      ({ sha, parentSha }) => {
        sessionStorage.setItem(
          'git-native-ui-state',
          JSON.stringify({
            repositoryId: 'one',
            activeView: 'log',
            scope: { kind: 'head' },
            text: '',
            selectedRefId: null,
            selection: { sha, parentSha, filePath: null },
            anchor: null,
            paneWidths: [220, 350],
          }),
        );
      },
      { sha, parentSha },
    );
    await page.goto(route + '?startup-refresh');
    await expect(page.locator(`[data-sha="${sha}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#details')).toContainText('Commit 2');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(sessionStorage.getItem('git-native-ui-state')!)
              .selection,
        ),
      )
      .toEqual({ sha, parentSha, filePath: null });
    expect(
      await page.evaluate(() =>
        window.__requests
          .filter((request) => request.body.kind === 'restore')
          .map((request) => request.generation),
      ),
    ).toEqual([1, 2]);
    expect(await page.evaluate(() => window.__acquisitions)).toBe(1);
  });
}

for (const route of ['/', '/development.html'])
  test(`saved Worktrees is selected on every startup render on ${route}`, async ({
    page,
  }) => {
    await page.goto(route);
    await page.getByRole('tab', { name: 'Worktrees', exact: true }).click();
    await page.addInitScript(() => {
      const selections: string[] = [];

      Reflect.set(window, 'startupTabs', selections);
      new MutationObserver(() => {
        const selected = document.querySelector(
          '[role="tab"][aria-selected="true"]',
        );

        if (selected)
          selections.push(
            selected.getAttribute('aria-label') ?? selected.textContent ?? '',
          );
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-selected'],
      });
    });
    await page.reload();
    await expect(
      page.getByRole('tab', { name: 'Worktrees', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__requests.filter(({ body }) => body.kind === 'worktrees')
              .length,
        ),
      )
      .toBe(1);
    const selections = await page.evaluate(
      () => Reflect.get(window, 'startupTabs') as string[],
    );

    expect(selections.length).toBeGreaterThan(0);
    expect(new Set(selections)).toEqual(new Set(['Worktrees']));
  });
