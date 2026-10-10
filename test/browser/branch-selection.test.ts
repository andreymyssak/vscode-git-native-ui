import { updateReferences } from '../fixtures/branch-references';
import { expect, test } from '../fixtures/browser';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.goto('/');
});

for (const reverse of [false, true])
  test(`Shift branch range retains selected right-click group, reverse=${reverse}`, async ({
    page,
  }) => {
    await expect(page.locator('[data-commit-row]').first()).toBeVisible();
    await updateReferences(page, [
      'main',
      'alpha',
      'beta',
      'gamma',
      'feature/hidden',
    ]);
    const first = page.locator(
      `[data-ref="refs/heads/${reverse ? 'gamma' : 'alpha'}"]`,
    );
    const last = page.locator(
      `[data-ref="refs/heads/${reverse ? 'alpha' : 'gamma'}"]`,
    );

    await first.click();
    await last.click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(
      3,
    );
    const middle = page.locator('[data-ref="refs/heads/beta"]');

    await middle.click({ button: 'right' });
    await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(
      3,
    );
    await expect
      .poll(async () =>
        JSON.parse((await middle.getAttribute('data-vscode-context')) ?? '{}'),
      )
      .toMatchObject({
        refSelectionCount: 3,
        refIds: ['refs/heads/alpha', 'refs/heads/beta', 'refs/heads/gamma'],
        refsCanDelete: true,
      });
    await page
      .locator('[data-ref="refs/heads/main"]')
      .click({ button: 'right' });
    await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(
      1,
    );
  });

test('branch range prunes search-hidden targets and disables current-branch deletion', async ({
  page,
}) => {
  await expect(page.locator('[data-commit-row]').first()).toBeVisible();
  await updateReferences(page, ['main', 'alpha', 'beta', 'gamma']);
  await page.locator('[data-ref="refs/heads/main"]').click();
  const beta = page.locator('[data-ref="refs/heads/beta"]');

  await page
    .locator('[data-ref="refs/heads/gamma"]')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(4);
  await expect
    .poll(
      async () =>
        JSON.parse((await beta.getAttribute('data-vscode-context')) ?? '{}')
          .refsCanDelete,
    )
    .toBe(false);
  await page.getByRole('searchbox', { name: 'Branch or tag' }).fill('beta');
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(1);
  await expect
    .poll(
      async () =>
        JSON.parse((await beta.getAttribute('data-vscode-context')) ?? '{}')
          .refIds,
    )
    .toEqual(['refs/heads/beta']);
  await page.getByRole('searchbox', { name: 'Branch or tag' }).fill('');
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(1);
});

test('branch ranges survive refresh, skip collapsed leaves and prune a collapsed folder', async ({
  page,
}) => {
  await expect(page.locator('[data-commit-row]').first()).toBeVisible();
  const refs = ['main', 'alpha', 'gamma', 'feature/hidden'];

  await updateReferences(page, refs);
  await page.locator('[data-ref="refs/heads/alpha"]').click();
  await page
    .locator('[data-ref="refs/heads/gamma"]')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(2);
  await updateReferences(page, refs);
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(2);
  const folder = page.locator('[data-tree-node="folder:local:feature/"]');

  await folder.focus();
  await folder.press('ArrowRight');
  await page.locator('[data-ref="refs/heads/feature/hidden"]').click();
  await page
    .locator('[data-ref="refs/heads/gamma"]')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(3);
  await folder.focus();
  await folder.press('ArrowLeft');
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(2);
  await folder.press('ArrowRight');
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(2);
});

test('branch keyboard and toggle selection retain their native multiselect behavior', async ({
  page,
}) => {
  await expect(page.locator('[data-commit-row]').first()).toBeVisible();
  await updateReferences(page, ['main', 'alpha', 'beta', 'gamma']);
  const alpha = page.locator('[data-ref="refs/heads/alpha"]');
  const beta = page.locator('[data-ref="refs/heads/beta"]');
  const gamma = page.locator('[data-ref="refs/heads/gamma"]');

  await alpha.click();
  await alpha.press('Shift+ArrowDown');
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(2);
  await gamma.click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(3);
  await beta.click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(2);
});

test('a branch range containing a remote disables batch deletion', async ({
  page,
}) => {
  await expect(page.locator('[data-commit-row]').first()).toBeVisible();
  await updateReferences(page, ['main', 'alpha', 'beta']);
  await page
    .getByRole('treeitem', { name: 'Remote', exact: true })
    .press('ArrowRight');
  await page
    .locator('[data-tree-node="folder:remote:origin/"]')
    .press('ArrowRight');
  const alpha = page.locator('[data-ref="refs/heads/alpha"]');
  const remote = page.locator('[data-ref="refs/remotes/origin/main"]');

  await alpha.click();
  await remote.click({ modifiers: ['Shift'] });
  await expect(remote).toHaveAttribute('aria-selected', 'true');
  const context = JSON.parse(
    (await remote.getAttribute('data-vscode-context'))!,
  );

  expect(context.refSelectionCount).toBeGreaterThan(1);
  expect(context.refsCanDelete).toBe(false);
});

test('repository switches do not resurrect a previous branch range', async ({
  page,
}) => {
  await expect(page.locator('[data-commit-row]').first()).toBeVisible();
  const refs = ['main', 'alpha', 'beta'];
  const sha = '1'.padStart(40, '0');

  await updateReferences(page, refs);
  await page.locator('[data-ref="refs/heads/alpha"]').click();
  await page
    .locator('[data-ref="refs/heads/beta"]')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(2);
  await updateReferences(page, refs, sha, 'main', 'two', 2);
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(1);
  await updateReferences(page, refs, sha, 'main', 'one', 3);
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(1);
});

test('native integration context permits other local/remote branches and excludes current, tags and detached checkout', async ({
  page,
}) => {
  await expect(page.locator('[data-commit-row]').first()).toBeVisible();
  await updateReferences(page);
  for (const [refId, expected] of [
    ['refs/heads/main', false],
    ['refs/heads/topic', true],
    ['refs/remotes/origin/main', true],
    ['refs/tags/@wk/api_v2.1.0', false],
  ] as const) {
    await page
      .getByRole('searchbox', { name: 'Branch or tag' })
      .fill(refId.replace(/^refs\/(?:heads|remotes|tags)\//, ''));
    const item = page.locator(`[data-ref="${refId}"]`);

    await expect(item, refId).toHaveCount(1);
    await expect
      .poll(
        async () =>
          JSON.parse((await item.getAttribute('data-vscode-context')) ?? '{}')
            .refCanIntegrate,
      )
      .toBe(expected);
  }

  await updateReferences(page, ['main', 'topic'], '1'.padStart(40, '0'), null);
  await page.getByRole('searchbox', { name: 'Branch or tag' }).fill('topic');
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await page
            .locator('[data-ref="refs/heads/topic"]')
            .getAttribute('data-vscode-context')) ?? '{}',
        ).refCanIntegrate,
    )
    .toBe(false);
  expect(
    (await page.evaluate(() => window.__requests)).filter(
      (request) => request.body.kind === 'action',
    ),
  ).toHaveLength(0);
});

test('right-click selects the target and exposes a native branch menu context', async ({
  page,
}) => {
  const topic = page.getByRole('treeitem', { name: 'topic', exact: true });

  await topic.click({ button: 'right' });
  await expect(topic).toHaveAttribute('aria-selected', 'true');
  const context = JSON.parse(
    (await topic.getAttribute('data-vscode-context')) ?? '{}',
  );

  expect(context).toMatchObject({
    webviewSection: 'branch',
    repositoryId: 'one',
    refId: 'refs/heads/topic',
    refKind: 'local',
    refCurrent: false,
    generation: 1,
    preventDefaultContextMenuItems: true,
  });
  await expect(topic).toBeFocused();
  await expect(page.locator('#scope')).toHaveText('main');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('separator', { name: 'Resize branches' }),
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(topic).toBeFocused();
});

test('keyboard context menu keeps focus and exposes the focused branch', async ({
  page,
}) => {
  const topic = page.getByRole('treeitem', { name: 'topic', exact: true });

  await topic.focus();
  await topic.press('Shift+F10');
  await expect(topic).toHaveAttribute('aria-selected', 'true');
  await expect(topic).toBeFocused();
  await expect(page.locator('#scope')).toHaveText('main');
  expect(
    (await page.evaluate(() => window.__requests)).filter(
      (request) => request.body.kind === 'action',
    ),
  ).toHaveLength(0);
});

test('a saved empty selection defaults to the current local branch', async ({
  page,
}) => {
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('git-ui-native-state')!);

    saved.selectedRefId = null;
    sessionStorage.setItem('git-ui-native-state', JSON.stringify(saved));
  });
  await page.reload();
  await expect(
    page.getByRole('treeitem', { name: 'main (Current branch)', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
});

test('selecting a folder clears reference selection and highlights the whole row', async ({
  page,
}) => {
  await page.getByRole('treeitem', { name: 'topic', exact: true }).click();
  const folder = page.getByRole('treeitem', { name: 'feature', exact: true });

  await folder.click();
  await expect(folder).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('treeitem', { name: 'topic', exact: true }),
  ).toHaveAttribute('aria-selected', 'false');
  const tree = (await page
    .getByRole('tree', { name: 'References' })
    .boundingBox())!;
  const folderBounds = (await folder.boundingBox())!;

  expect(Math.abs(folderBounds.x - tree.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(folderBounds.width - tree.width)).toBeLessThanOrEqual(1);
  const nested = page.getByRole('treeitem', { name: 'nested', exact: true });
  const nestedBounds = (await nested.boundingBox())!;

  expect(Math.abs(nestedBounds.x - tree.x)).toBeLessThanOrEqual(1);
  await nested.click({ position: { x: 2, y: nestedBounds.height / 2 } });
  await expect(nested).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#scope')).toHaveText('main');
});
