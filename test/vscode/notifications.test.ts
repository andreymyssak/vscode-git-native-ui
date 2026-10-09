import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import { showOperationError } from '../../src/extension/native/operation-feedback';
import { nativeBrowser } from '../fixtures/native-panel';

describe('operation result notification lifecycle', () => {
  it('reporting an error completes while its actionable notification remains visible', async () => {
    const browser = await nativeBrowser();
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) =>
        candidate.url().includes('/workbench/workbench.html'),
      );

    assert.ok(page);
    // This isolated test window can retain other fixtures' notifications.
    // Start with an empty center so its virtual list displays this result.
    await vscode.commands.executeCommand('notifications.clearAll');
    await vscode.commands.executeCommand('notifications.hideList');
    await page.bringToFront();
    let completed = false;
    const report = showOperationError('Fixture completed operation error').then(
      () => {
        completed = true;
      },
    );

    try {
      await expect.poll(() => completed).toBe(true);
      await vscode.commands.executeCommand('notifications.showList');
      // Toasts and an already-open notification center expose different roles.
      await expect(
        page.getByText('Fixture completed operation error', { exact: true }),
      )
        .toBeVisible()
        .catch(async (error: unknown) => {
          await writeFile(
            '.artifacts/error-notification-diagnostic.json',
            JSON.stringify(
              await Promise.all(
                browser
                  .contexts()
                  .flatMap((context) => context.pages())
                  .map(async (candidate) => ({
                    url: candidate.url(),
                    text: await candidate.locator('body').innerText(),
                  })),
              ),
              null,
              2,
            ),
          );
          throw error;
        });
    } finally {
      await vscode.commands.executeCommand('notifications.showList');
      const dismiss = page
        .locator('.notification-list-item')
        .filter({ hasText: 'Fixture completed operation error' })
        .getByRole('button', { name: 'Dismiss', exact: true });

      if (await dismiss.count())
        await dismiss.evaluate((node) => (node as HTMLElement).click());
      await report;
      await vscode.commands.executeCommand('notifications.hideList');
    }
  });
});
