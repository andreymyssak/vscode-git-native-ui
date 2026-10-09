import { expect, test } from '@playwright/test';

import { loadHistoryPages } from './history-paging';

test('loading response stays within 100 ms independently of Git duration', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('searchbox', { name: 'Text or hash' })
    .fill('performance');
  const measurements = await page.evaluate(async () => {
    const deliver = window.__deliver;

    window.__deliver = (message) => {
      if (message.body.kind === 'history')
        window.addEventListener(
          'finish-performance',
          () => {
            window.__deliver = deliver;
            deliver(message);
          },
          { once: true },
        );
      else deliver(message);
    };

    const input = document.getElementById('search') as HTMLInputElement;
    const started = performance.now();

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    return {
      loading: document.getElementById('status')!.textContent,
      elapsed: performance.now() - started,
    };
  });

  expect(measurements.loading).toContain('Loading');
  expect(measurements.elapsed).toBeLessThanOrEqual(100);
  await page.evaluate(() =>
    window.dispatchEvent(new Event('finish-performance')),
  );
  await loadHistoryPages(page, 10);
  expect(await page.locator('[data-commit-row]').count()).toBeLessThanOrEqual(
    300,
  );
  const duration = await page.evaluate(
    () => performance.getEntriesByName('git-native-ui.render').at(-1)?.duration,
  );

  expect(duration).toBeLessThanOrEqual(100);
});

test('a very tall history viewport keeps bounded rows and correct scrolled geometry', async ({
  page,
}) => {
  await page.goto('/');
  await loadHistoryPages(page, 10);
  await page.setViewportSize({ width: 1280, height: 10000 });
  await expect(page.locator('[data-commit-row]')).toHaveCount(300);
  await page.locator('#history').evaluate((node) => {
    node.scrollTop = 8800;
  });
  const row = page.locator(
    '[data-sha="' + (401).toString(16).padStart(40, '0') + '"]',
  );

  await expect(row).toBeVisible();
  await expect(row).toHaveCSS('top', '8800px');
  expect(await page.locator('[data-commit-row]').count()).toBeLessThanOrEqual(
    300,
  );
  await expect(
    page.locator('[data-sha="' + '1'.padStart(40, '0') + '"]'),
  ).toHaveCount(0);
});
