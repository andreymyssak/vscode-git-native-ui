import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function loadHistoryPages(page: Page, pages: number) {
  for (let index = 1; index < pages; index++) {
    await page.locator('#history').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(page.locator('[data-history-content]')).toHaveCSS(
      'height',
      `${(index + 1) * 200 * 22}px`,
    );
  }
}
