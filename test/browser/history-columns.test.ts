import { expect, type Locator, type Page, test } from '../fixtures/browser';

async function widths(page: Page): Promise<number[]> {
  let measured: number[] = [];

  // The initial pane resize arrives after the first rows become visible.
  await expect
    .poll(async () => {
      const geometry = await page
        .locator('[data-commit-row]')
        .first()
        .evaluate((row) => ({
          columns: [...row.children].map(
            (cell) => cell.getBoundingClientRect().width,
          ),
          available: row.closest('#history')?.clientWidth,
        }));

      measured = geometry.columns;

      return (
        measured.reduce((total, width) => total + width, 0) -
        (geometry.available ?? 0)
      );
    })
    .toBeCloseTo(0, 0);

  return measured;
}

async function drag(page: Page, handle: Locator, delta: number): Promise<void> {
  const bounds = (await handle.boundingBox())!;

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + 12, {
    steps: 5,
  });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('dragging each column boundary resizes its neighbors in either direction', async ({
  page,
}) => {
  const first = page.getByRole('separator', {
    name: 'Resize Commit and Author columns',
  });
  const second = page.getByRole('separator', {
    name: 'Resize Author and Date columns',
  });

  await expect(first).toBeVisible();
  const before = await widths(page);

  await drag(page, first, 40);
  const enlarged = await widths(page);

  expect(enlarged[0]! - before[0]!).toBeCloseTo(40, 0);
  expect(before[1]! - enlarged[1]!).toBeCloseTo(40, 0);
  expect(enlarged[2]).toBeCloseTo(before[2]!, 0);
  await drag(page, first, -40);
  const restored = await widths(page);

  restored.forEach((width, index) =>
    expect(width).toBeCloseTo(before[index]!, 0),
  );
  await drag(page, second, 30);
  const author = await widths(page);

  expect(author[0]).toBeCloseTo(before[0]!, 0);
  expect(author[1]! - before[1]!).toBeCloseTo(30, 0);
  expect(before[2]! - author[2]!).toBeCloseTo(30, 0);
  await drag(page, second, -30);
  (await widths(page)).forEach((width, index) =>
    expect(width).toBeCloseTo(before[index]!, 0),
  );
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});

test('column widths survive reopening and can be reset with a double-click', async ({
  page,
}) => {
  const divider = page.getByRole('separator', {
    name: 'Resize Commit and Author columns',
  });
  const before = await widths(page);

  await drag(page, divider, -50);
  const changed = await widths(page);

  await page.getByRole('tab', { name: 'Worktrees', exact: true }).click();
  await page.getByRole('tab', { name: 'Log', exact: true }).click();
  await expect(page.locator('#log-view')).toBeVisible();
  (await widths(page)).forEach((width, index) =>
    expect(width).toBeCloseTo(changed[index]!, 0),
  );
  await page.reload();
  await expect(divider).toBeVisible();
  (await widths(page)).forEach((width, index) =>
    expect(width).toBeCloseTo(changed[index]!, 0),
  );
  await divider.dblclick();
  (await widths(page)).forEach((width, index) =>
    expect(width).toBeCloseTo(before[index]!, 0),
  );
});

test('resizing keeps reference markers attached to the message column', async ({
  page,
}) => {
  const divider = page.getByRole('separator', {
    name: 'Resize Commit and Author columns',
  });

  await drag(page, divider, -50);
  const history = (await page
    .locator('[data-history-cell]')
    .first()
    .boundingBox())!;
  const refs = (await page.locator('[data-references]').first().boundingBox())!;

  expect(refs.x + refs.width).toBeCloseTo(history.x + history.width, 0);
  const author = (await page.locator('[data-author]').first().boundingBox())!;

  expect(author.x).toBeCloseTo(history.x + history.width, 0);
});

test('wide-window column adjustments survive reopening', async ({ page }) => {
  await page.setViewportSize({ width: 6000, height: 280 });
  const divider = page.getByRole('separator', {
    name: 'Resize Commit and Author columns',
  });

  await drag(page, divider, -100);
  const changed = await widths(page);

  await page.reload();
  await expect(divider).toBeVisible();
  (await widths(page)).forEach((width, index) =>
    expect(width).toBeCloseTo(changed[index]!, 0),
  );
});

test('changing an outer pane immediately realigns the column boundaries', async ({
  page,
}) => {
  await page.getByRole('separator', { name: 'Resize branches' }).focus();
  await page.keyboard.press('ArrowRight');
  const geometry = await page.evaluate(() => {
    const history = document.getElementById('history')!;
    const viewport = history.getBoundingClientRect();
    const date = document.querySelector('[data-date]')!.getBoundingClientRect();

    return {
      right: viewport.right,
      dateRight: date.right,
      width: history.clientWidth,
      scroll: history.scrollWidth,
    };
  });

  expect(geometry.dateRight).toBeCloseTo(geometry.right, 0);
  expect(geometry.scroll).toBe(geometry.width);
});

test('keyboard resizing keeps handles aligned and cancelled drags stop resizing', async ({
  page,
}) => {
  const divider = page.getByRole('separator', {
    name: 'Resize Commit and Author columns',
  });

  await expect(divider).toBeVisible();
  const before = await widths(page);

  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  const keyed = await widths(page);

  expect(before[0]! - keyed[0]!).toBeCloseTo(10, 0);
  const cell = (await page
    .locator('[data-history-cell]')
    .first()
    .boundingBox())!;
  const handle = (await divider.boundingBox())!;

  expect(handle.x + handle.width / 2).toBeCloseTo(cell.x + cell.width, 0);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 12);
  await page.mouse.down();
  await divider.dispatchEvent('pointercancel');
  await page.mouse.move(handle.x + 80, handle.y + 12);
  await page.mouse.up();
  (await widths(page)).forEach((width, index) =>
    expect(width).toBeCloseTo(keyed[index]!, 0),
  );
});

test('oversized restored columns fit a narrow pane and resize from their visible boundaries', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 280 });
  await page.addInitScript(() => {
    const saved = JSON.parse(sessionStorage.getItem('git-native-ui-state')!);

    saved.historyColumnWidths = [900, 800];
    sessionStorage.setItem('git-native-ui-state', JSON.stringify(saved));
  });
  await page.reload();
  const divider = page.getByRole('separator', {
    name: 'Resize Commit and Author columns',
  });

  await expect(divider).toBeInViewport({ ratio: 1 });
  await expect(page.locator('[data-date]').first()).toBeInViewport({
    ratio: 1,
  });
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem('git-native-ui-state')!)
          .historyColumnWidths,
    ),
  ).toEqual([900, 800]);
  const before = await widths(page);

  await drag(page, divider, 10);
  const after = await widths(page);

  expect(after[0]! - before[0]!).toBeCloseTo(10, 0);
  const geometry = await page
    .locator('[data-commit-row]')
    .evaluateAll((rows) =>
      rows.map((row) =>
        [...row.children].map((cell) => cell.getBoundingClientRect().x),
      ),
    );

  expect(geometry[1]).toEqual(geometry[0]);
});
