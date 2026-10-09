import { expect, type Page, test } from '../fixtures/browser';

const sha = (index: number) => index.toString(16).padStart(40, '0');
const row = (page: Page, index: number) =>
  page.locator(`[data-commit-row][data-sha="${sha(index)}"]`);

async function history(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-commit-row]').first()).toBeVisible();
  await page.evaluate(
    (identities) =>
      window.__deliver({
        requestId: 'graph-interactions',
        repositoryId: 'one',
        generation: 1,
        body: {
          kind: 'history',
          append: false,
          scope: { kind: 'all' },
          text: '',
          repository: {
            id: 'one',
            label: 'Graph fixture',
            rootUri: 'file:///example',
            branch: 'main',
            headSha: identities[0]!,
          },
          page: {
            scopeId: 'graph-interactions',
            nextCursor: null,
            commits: identities.map((identity, index) => ({
              sha: identity,
              parents:
                index === 0
                  ? [identities[1]!]
                  : index === 1
                    ? [identities[2]!, identities[3]!]
                    : index === 2
                      ? [identities[3]!]
                      : [],
              message:
                index === 0
                  ? 'Checkout subject\n\nFull commit body'
                  : index === 1
                    ? 'Merge two branches'
                    : 'Ordinary commit',
              authorName: 'Graph Author',
              authorEmail: 'author@example.test',
              authorDate: '2026-10-01T09:00:00Z',
              commitDate: '2026-10-02T10:00:00Z',
            })),
            refs: [
              {
                id: 'refs/heads/main',
                name: 'main',
                kind: 'local',
                sha: identities[0]!,
                remote: null,
              },
            ],
          },
        },
      }),
    [sha(1), sha(2), sha(3), sha(4)],
  );
  await expect(row(page, 1)).toContainText('Checkout subject');
}

for (const [theme, background, hover, active, inactive] of [
  ['dark', '#1e1e1e', '#2a2d2e', '#094771', '#37373d'],
  ['light', '#ffffff', '#f0f0f0', '#0060c0', '#e4e6f1'],
  ['high contrast', '#000000', '#202020', '#006080', '#303030'],
] as const) {
  test(`graph circles follow hover and active/inactive row selection in ${theme}`, async ({
    page,
  }) => {
    await history(page);
    await page.evaluate(
      ({ background, hover, active, inactive }) => {
        for (const [name, value] of Object.entries({
          'editor-background': background,
          'list-hoverBackground': hover,
          'list-activeSelectionBackground': active,
          'list-inactiveSelectionBackground': inactive,
        }))
          document.documentElement.style.setProperty('--vscode-' + name, value);
      },
      { background, hover, active, inactive },
    );
    const rgb = (hex: string) =>
      `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
    const head = row(page, 1);
    const merge = row(page, 2);
    const ordinary = row(page, 3);
    const laneColor = await ordinary
      .locator('svg circle')
      .evaluate((node) => getComputedStyle(node).fill);

    await expect(head.locator('svg circle')).toHaveCount(2);
    await expect(head.locator('svg circle').last()).toHaveCSS(
      'fill',
      rgb(background),
    );
    await expect(merge.locator('svg circle')).toHaveCount(2);
    await expect(merge.locator('svg circle').last()).toHaveCSS(
      'stroke',
      rgb(background),
    );
    for (const target of [head, merge, ordinary]) {
      await target.locator('[data-commit-graph]').hover();
      await expect(target).toHaveCSS('background-color', rgb(hover));
      await expect(target.locator('svg circle').first()).toHaveCSS(
        'stroke',
        'rgba(0, 0, 0, 0)',
      );
      await target.locator('[data-commit-graph]').click();
      await expect(target).toHaveAttribute('aria-selected', 'true');
      await expect(target).toHaveCSS('background-color', rgb(active));
      if (target !== ordinary) {
        await expect(target.locator('svg circle').last()).toHaveCSS(
          'stroke',
          rgb(active),
        );
      }

      await page.getByRole('searchbox', { name: 'Text or hash' }).focus();
      await expect(target).toHaveCSS('background-color', rgb(inactive));
    }

    await expect(head.locator('svg circle')).toHaveCount(2);
    await expect(head).toHaveAttribute('aria-selected', 'false');
    await expect(ordinary.locator('svg circle')).toHaveCount(1);
    await expect(ordinary.locator('svg circle')).toHaveCSS('fill', laneColor);
  });
}

test('graph hover and focus leave details in the right pane until activation', async ({
  page,
}) => {
  await history(page);
  const before = await page.evaluate(() => window.__requests.length);
  const head = row(page, 1);

  await head.locator('[data-commit-graph]').hover();
  await expect(page.locator('#details')).toContainText('Select a commit');
  await head.focus();
  await expect(head).toHaveAccessibleDescription(/Current checkout/);
  await expect(page.locator('#details')).toContainText('Select a commit');
  await expect(head).toHaveAttribute('aria-selected', 'false');
  expect(await page.evaluate(() => window.__requests.length)).toBe(before);
  await head.locator('[data-commit-graph]').click();
  await expect(head).toHaveAttribute('aria-selected', 'true');
  expect((await page.evaluate(() => window.__requests)).at(-1)?.body).toEqual({
    kind: 'select-commits',
    activeSha: sha(1),
    shas: [sha(1)],
  });
  await expect(page.locator(`#details [title="${sha(1)}"]`)).toBeVisible();
});

test('keyboard browsing preserves the checkout marker and reference hover list', async ({
  page,
}) => {
  await history(page);
  const head = row(page, 1);
  const merge = row(page, 2);

  await head.press('ArrowDown');
  await expect(merge).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(head).toBeFocused();
  await expect(head.locator('svg circle')).toHaveCount(2);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await head.locator('[data-references]').hover();
  await expect(page.getByRole('tooltip')).toHaveCount(1);
  await expect(page.getByRole('tooltip')).toContainText('Local branch');
  await expect(page.getByRole('tooltip')).toContainText('main');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});
