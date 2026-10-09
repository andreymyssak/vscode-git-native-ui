import { expect, test } from '../fixtures/browser';

test('tree filtering, clearing and reload preserve other filters without checkout', async ({
  page,
}) => {
  await page.goto('/');
  const topic = page.getByRole('treeitem', { name: 'topic', exact: true });

  await topic.click();
  await expect(page.locator('#scope')).toHaveText('main');
  await topic.dblclick();
  await expect(page.locator('#scope')).toHaveText('topic');
  await page.getByRole('button', { name: 'Date filter', exact: true }).click();
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await page.reload();
  await expect(page.locator('#scope')).toHaveText('topic');
  await page
    .getByRole('treeitem', { name: 'All branches', exact: true })
    .dblclick();
  await expect(page.locator('#scope')).toHaveText('All branches');
  await expect(
    page.getByRole('treeitem', { name: 'All branches', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(
    page.getByRole('treeitem', { name: 'All branches', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-ref][aria-selected="true"]')).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.__requests)).at(-1)?.body,
  ).toMatchObject({
    kind: 'restore',
    scope: { kind: 'all' },
    filters: { date: '7d' },
  });
  expect(
    (await page.evaluate(() => window.__requests)).some(
      (request) => request.body.kind === 'action',
    ),
  ).toBe(false);
  await page
    .getByRole('treeitem', { name: 'HEAD (Current Branch)', exact: true })
    .dblclick();
  await expect(page.locator('#scope')).toHaveText('main');
  await expect(
    page.getByRole('button', { name: 'Date filter', exact: true }),
  ).toHaveText('Last 7 days');
});

test('branch loading keeps the remaining toolbar controls in place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 600 });
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Text or hash' });
  const before = await search.boundingBox();

  await page.evaluate(() => {
    const deliver = window.__deliver;

    window.__deliver = (message) => {
      if (message.body.kind === 'history')
        window.addEventListener('finish-branch', () => deliver(message), {
          once: true,
        });
      else deliver(message);
    };
  });
  await page.getByRole('treeitem', { name: 'topic', exact: true }).dblclick();
  await expect(page.locator('#history-pane')).toHaveAttribute(
    'aria-busy',
    'true',
  );
  expect(await search.boundingBox()).toEqual(before);
  await page.evaluate(() => window.dispatchEvent(new Event('finish-branch')));
  await expect(page.locator('#history-pane')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  expect(await search.boundingBox()).toEqual(before);
});

test('search inputs stay aligned while each pane sizes its own header', async ({
  page,
}) => {
  for (const width of [1500, 950, 720, 620]) {
    await page.setViewportSize({ width, height: 600 });
    await page.goto('/');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const branch = document
            .querySelector('#reference-search')
            ?.getBoundingClientRect();
          const text = document
            .querySelector('#search')
            ?.getBoundingClientRect();
          const left = document
            .querySelector('#branch-search')
            ?.getBoundingClientRect();
          const right = document
            .querySelector('[aria-label="History filters and actions"]')
            ?.getBoundingClientRect();

          if (!branch || !text || !left || !right) return null;

          return [branch.height, text.height, branch.y - text.y, left.height];
        }),
      )
      .toEqual([28, 28, 0, 35]);
  }
});

test('wrapping history filters does not add blank space below branch search', async ({
  page,
}) => {
  await page.setViewportSize({ width: 950, height: 600 });
  await page.goto('/');
  const branch = (await page.locator('#branch-search').boundingBox())!;
  const history = (await page
    .getByRole('toolbar', { name: 'History filters and actions' })
    .boundingBox())!;
  const firstBranch = (await page
    .getByRole('treeitem', { name: 'All branches', exact: true })
    .boundingBox())!;

  expect(history.height).toBeGreaterThan(branch.height);
  expect(firstBranch.y - branch.y - branch.height).toBeLessThanOrEqual(3);
});
