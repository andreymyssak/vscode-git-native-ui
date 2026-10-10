import { expect, test } from '../fixtures/browser';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    Reflect.set(window, 'menuAnchors', []);
    window.addEventListener('pointerdown', (event) => {
      Reflect.set(window, 'menuPointer', {
        x: event.clientX,
        y: event.clientY,
      });
    });
    window.addEventListener('contextmenu', (event) => {
      if (event.defaultPrevented) return;
      const target = (event.target as HTMLElement).closest(
        '[data-vscode-context]',
      );
      const anchors = Reflect.get(window, 'menuAnchors') as unknown[];

      anchors.push({
        x: event.clientX,
        y: event.clientY,
        context: JSON.parse(
          target?.getAttribute('data-vscode-context') ?? '{}',
        ),
      });
    });
  });
});

for (const [name, selector, identity] of [
  [
    'commit',
    '[data-commit-row][data-sha="0000000000000000000000000000000000000002"]',
    { commitSha: '0000000000000000000000000000000000000002' },
  ],
  ['branch', '[data-ref="refs/heads/main"]', { refId: 'refs/heads/main' }],
] as const) {
  test(`${name} pointer menu opens away from the click with one current context`, async ({
    page,
  }) => {
    await page.locator(selector).click({ button: 'right' });
    const result = await page.evaluate(() => ({
      pointer: Reflect.get(window, 'menuPointer') as { x: number; y: number },
      anchors: Reflect.get(window, 'menuAnchors') as {
        x: number;
        y: number;
        context: object;
      }[],
    }));

    expect(result.anchors).toHaveLength(1);
    expect(result.anchors[0]!.x).toBeGreaterThan(result.pointer.x);
    expect(result.anchors[0]!.y).toBeGreaterThan(result.pointer.y);
    expect(result.anchors[0]!.context).toMatchObject(identity);
    await expect(page.locator(selector)).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
}

test('keyboard menu keeps its row anchor and emits one current context', async ({
  page,
}) => {
  const row = page.locator('[data-commit-row]').nth(1);

  await row.click();
  const bounds = await row.boundingBox();

  expect(bounds).not.toBeNull();
  await row.press('Shift+F10');
  const anchors = await page.evaluate(
    () => Reflect.get(window, 'menuAnchors') as { x: number; y: number }[],
  );

  expect(anchors).toHaveLength(1);
  expect(anchors[0]!.x).toBeCloseTo(bounds!.x + 20);
  expect(anchors[0]!.y).toBeCloseTo(bounds!.y + 11);
  await expect(row).toBeFocused();
});
