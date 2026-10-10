import { updateReferences } from '../fixtures/branch-references';
import { expect, test } from '../fixtures/browser';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.goto('/');
});

test('tracking tooltip omits unavailable counts and fits a short panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 200 });
  await page.evaluate(() =>
    window.__deliver({
      requestId: 'tracking',
      repositoryId: 'one',
      generation: 1,
      body: {
        kind: 'references',
        references: [
          {
            id: 'refs/heads/main',
            name: 'main',
            kind: 'local',
            sha: '1'.padStart(40, '0'),
            remote: null,
            tracking: {
              upstream: 'refs/remotes/origin/main',
              ahead: null,
              behind: 3,
            },
          },
          {
            id: 'refs/heads/topic',
            name: 'topic',
            kind: 'local',
            sha: '1'.padStart(40, '0'),
            remote: null,
            tracking: {
              upstream: 'refs/remotes/origin/topic',
              ahead: 1,
              behind: 0,
            },
          },
        ],
      },
    }),
  );
  const incoming = page.locator('[data-incoming]');
  const tooltip = page.getByRole('tooltip');

  await incoming.hover();
  await expect(tooltip).toHaveText('3 incoming commits');
  await expect(incoming.locator('..')).toHaveAttribute(
    'aria-label',
    '3 incoming commits',
  );
  expect(
    await tooltip.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  const bounds = await tooltip.boundingBox();

  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(692);
  expect(bounds!.y).toBeGreaterThanOrEqual(8);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(192);
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
  await incoming.hover();
  await expect(tooltip).toBeVisible();
  const outgoing = page.locator('[data-outgoing]');

  await outgoing.hover();
  await expect(tooltip).toHaveText('1 outgoing commit');
  await expect(outgoing.locator('..')).toHaveAttribute(
    'aria-label',
    '1 outgoing commit',
  );
  await updateReferences(page, ['main']);
  await expect(tooltip).toBeHidden();
});

for (const palette of [
  { theme: 'dark', blue: 'rgb(55, 148, 255)', green: 'rgb(137, 209, 133)' },
  { theme: 'light', blue: 'rgb(0, 95, 184)', green: 'rgb(56, 138, 52)' },
]) {
  test(`tracked branches keep blue/green counts and explain Update availability in ${palette.theme}`, async ({
    page,
  }) => {
    await page.evaluate(({ blue, green, theme }) => {
      document.body.classList.add('vscode-' + theme);
      document.documentElement.style.setProperty('--vscode-charts-blue', blue);
      document.documentElement.style.setProperty(
        '--vscode-charts-green',
        green,
      );
      document.documentElement.style.setProperty(
        '--vscode-gitDecoration-modifiedResourceForeground',
        'rgb(215, 186, 125)',
      );
      document.documentElement.style.setProperty(
        '--vscode-gitDecoration-addedResourceForeground',
        'rgb(215, 186, 125)',
      );
    }, palette);
    await page.evaluate(() =>
      window.__deliver({
        requestId: 'tracking',
        repositoryId: 'one',
        generation: 1,
        body: {
          kind: 'references',
          references: [
            {
              id: 'refs/heads/main',
              name: 'main',
              kind: 'local',
              sha: '1'.padStart(40, '0'),
              remote: null,
              tracking: {
                upstream: 'refs/remotes/origin/main',
                ahead: 2,
                behind: 105,
              },
            },
            {
              id: 'refs/heads/topic',
              name: 'topic',
              kind: 'local',
              sha: '2'.padStart(40, '0'),
              remote: null,
              tracking: {
                upstream: 'refs/remotes/origin/topic',
                ahead: 0,
                behind: 1,
              },
            },
          ],
        },
      }),
    );
    const current = page.locator('[data-current="true"]');

    await expect(current.locator('[data-incoming]')).toHaveText('99+');
    await expect(current.locator('[data-outgoing]')).toHaveText('2');
    await expect
      .soft(current.locator('[data-incoming]'))
      .toHaveCSS('color', palette.blue, { timeout: 500 });
    await expect
      .soft(current.locator('[data-incoming] .codicon'))
      .toHaveCSS('color', palette.blue, { timeout: 500 });
    await expect
      .soft(current.locator('[data-outgoing]'))
      .toHaveCSS('color', palette.green, { timeout: 500 });
    await expect
      .soft(current.locator('[data-outgoing] .codicon'))
      .toHaveCSS('color', palette.green, { timeout: 500 });
    for (const direction of ['incoming', 'outgoing']) {
      const glyph = current.locator(`[data-${direction}] .codicon`);

      expect(
        await glyph.evaluate(
          (node) => getComputedStyle(node, '::before').content,
        ),
      ).not.toMatch(/^(none|normal|""|''|)$/);
      expect(
        await glyph.evaluate((node) => {
          const transform = new DOMMatrix(getComputedStyle(node).transform);

          return (Math.atan2(transform.b, transform.a) * 180) / Math.PI;
        }),
      ).toBeCloseTo(45);
    }

    const rowBeforeHover = await current.boundingBox();
    const tooltip = page.getByRole('tooltip');

    await current.locator('[data-incoming]').hover();
    await expect(tooltip).toHaveText('105 incoming and 2 outgoing commits');
    await expect(tooltip).toHaveCount(1);
    expect(await current.boundingBox()).toEqual(rowBeforeHover);
    await current.locator('[data-outgoing]').hover();
    await expect(tooltip).toHaveText('105 incoming and 2 outgoing commits');
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    const currentContext = JSON.parse(
      (await current.getAttribute('data-vscode-context'))!,
    );

    expect(currentContext.refCanUpdate).toBe(true);
    await page.getByRole('treeitem', { name: 'topic', exact: true }).click();
    const topic = page.locator('[data-ref="refs/heads/topic"]');
    const context = JSON.parse(
      (await topic.getAttribute('data-vscode-context'))!,
    );

    expect(context.refCanUpdate).toBe(true);
    await topic.locator('[data-incoming]').hover();
    await expect(tooltip).toHaveText('1 incoming commit');
    await expect(topic.locator('[data-outgoing]')).toHaveCount(0);
    await topic.click({ button: 'right' });
    await expect(tooltip).toBeHidden();
    await expect(current.locator('[data-incoming]')).toHaveCSS(
      'color',
      palette.blue,
    );
    await expect(current.locator('[data-outgoing]')).toHaveCSS(
      'color',
      palette.green,
    );
  });
}
