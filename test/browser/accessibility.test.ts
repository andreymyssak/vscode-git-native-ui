import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/browser';

const sha = (number: number) => number.toString(16).padStart(40, '0');

async function focusAtMountedBoundary(page: Page) {
  await page.goto('/');
  const history = page.locator('#history');
  const current = page.locator(
    '[data-commit-row][data-sha="' + sha(120) + '"]',
  );

  await history.evaluate((node) => {
    node.scrollTop = 2400;
  });
  await current.click();
  await expect(current).toBeFocused();
  const wheel = await history.evaluate(
    (node) => 100 * 22 - node.clientHeight - 1 - node.scrollTop,
  );

  await history.hover();
  await page.mouse.wheel(0, wheel);
  await expect(page.locator('[data-commit-row]').last()).toHaveAttribute(
    'data-sha',
    sha(120),
  );
  await expect(
    page.locator('[data-commit-row][data-sha="' + sha(121) + '"]'),
  ).toHaveCount(0);
  await expect(current).toBeFocused();
}

test('keyboard navigation keeps focus when wheel scrolling leaves the next row unmounted', async ({
  page,
}) => {
  await focusAtMountedBoundary(page);
  const next = page.locator('[data-commit-row][data-sha="' + sha(121) + '"]');

  await page.keyboard.press('ArrowDown');
  await expect(next).toHaveAttribute('aria-selected', 'true');
  await expect(next).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.locator('[data-commit-row][data-sha="' + sha(122) + '"]'),
  ).toBeFocused();
});

test('a pending keyboard focus request is cancelled when the user focuses search', async ({
  page,
}) => {
  await focusAtMountedBoundary(page);
  await page.evaluate(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    document.getElementById('search')!.focus();
  });
  await expect(
    page.locator('[data-commit-row][data-sha="' + sha(121) + '"]'),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('searchbox', { name: 'Text or hash' }),
  ).toBeFocused();
});

for (const scheme of ['light', 'dark', 'high-contrast'] as const)
  test(`keyboard history and resizing in ${scheme}`, async ({ page }) => {
    await page.goto('/');
    await page.emulateMedia({
      colorScheme: scheme === 'light' ? 'light' : 'dark',
      forcedColors: scheme === 'high-contrast' ? 'active' : 'none',
    });
    await page.locator('[data-commit-row]').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(
      page.locator('[data-commit-row][aria-selected="true"]'),
    ).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await expect(
      page.locator('[data-commit-row][aria-selected="true"]'),
    ).toBeFocused();
    await page.getByRole('separator', { name: 'Resize details' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#log-view')).toHaveCSS(
      'grid-template-columns',
      /360px/,
    );
  });
