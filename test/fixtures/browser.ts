import { test as base } from '@playwright/test';

import { recoverBrowserNavigation } from './browser-navigation';

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const navigate = page.goto.bind(page);

    page.goto = (...args) =>
      recoverBrowserNavigation({
        navigate: () => navigate(...args),
        report: (error) => {
          testInfo.annotations.push({
            type: 'navigation recovery',
            description: error.message,
          });
          console.warn(
            `Retrying browser socket allocation once: ${error.message}`,
          );
        },
      });
    try {
      await use(page);
    } finally {
      page.goto = navigate;
    }
  },
});

export type { Locator, Page } from '@playwright/test';
export { expect } from '@playwright/test';
