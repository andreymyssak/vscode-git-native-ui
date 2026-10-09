import { basename } from 'node:path';

import type { Browser, Frame, Locator } from '@playwright/test';
import { chromium, expect } from '@playwright/test';
import * as vscode from 'vscode';

declare global {
  var gitNativeUINativeTestBrowser: Browser | undefined;
}
export async function nativeBrowser(): Promise<Browser> {
  globalThis.gitNativeUINativeTestBrowser ??= await chromium.connectOverCDP(
    `http://127.0.0.1:${process.env.VSCODE_TEST_DEBUG_PORT ?? ''}`,
  );

  return globalThis.gitNativeUINativeTestBrowser;
}

export async function nativePanel(repositoryId: string): Promise<Frame> {
  const browser = await nativeBrowser();
  let frame: Frame | undefined;

  await expect
    .poll(async () => {
      for (const context of browser.contexts())
        for (const page of context.pages())
          for (const candidate of page.frames()) {
            if (candidate.isDetached()) continue;
            const row = candidate.locator('[data-commit-row]').first();

            if (!(await row.count())) continue;
            const encoded = await row
              .getAttribute('data-vscode-context', {
                timeout: 100,
              })
              .catch(() => null);

            if (!encoded) continue;
            const current = JSON.parse(encoded) as {
              gitNativeUIRepositoryId: string;
            };

            if (current.gitNativeUIRepositoryId === repositoryId) {
              frame = candidate;

              return true;
            }
          }

      return false;
    })
    .toBe(true);

  if (!frame) throw new Error('Native Git history panel did not load.');

  return frame;
}

export async function selectNativeRepository(
  repositoryId: string,
): Promise<Frame> {
  const browser = await nativeBrowser();
  let frame: Frame | undefined;

  await expect
    .poll(async () => {
      for (const context of browser.contexts())
        for (const page of context.pages())
          for (const candidate of page.frames())
            if (
              !candidate.isDetached() &&
              (await candidate.locator('#branches').count())
            ) {
              frame = candidate;

              return true;
            }

      return false;
    })
    .toBe(true);

  if (!frame) throw new Error('Native Git history panel did not load.');
  await vscode.commands.executeCommand('notifications.hideToasts');
  const picker = frame.getByRole('button', {
    name: 'Select repository',
    exact: true,
  });

  if (await picker.isVisible()) {
    await picker.click();
    const input = frame
      .page()
      .getByPlaceholder('Select repository', { exact: true });

    await input.fill(basename(vscode.Uri.parse(repositoryId).fsPath));
    await expect(
      frame.page().locator('.quick-input-list .monaco-list-row'),
    ).toHaveCount(1);
    await input.press('Enter');
  }

  return nativePanel(repositoryId);
}

export function trackNativeDrafts(): { dispose(): Promise<void> } {
  const drafts = new Set<vscode.TextDocument>();
  const subscription = vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.uri.scheme === 'untitled') drafts.add(document);
  });

  return {
    async dispose() {
      subscription.dispose();
      const errors: unknown[] = [];

      for (const document of drafts) {
        if (document.isClosed) continue;
        try {
          await vscode.window.showTextDocument(document, { preview: false });
          await vscode.commands.executeCommand(
            'workbench.action.revertAndCloseActiveEditor',
          );
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length)
        throw new AggregateError(errors, 'Could not close native test drafts.');
    },
  };
}

export async function refreshNativeHistory(
  frame: Frame,
  repositoryId: string,
): Promise<Locator> {
  const row = frame
    .locator('#history-pane[aria-busy="false"] [data-commit-row]')
    .first();
  const previous = JSON.parse(
    (await row.getAttribute('data-vscode-context'))!,
  ) as { gitNativeUIGeneration: number };

  // Fixture cleanup can leave native toasts over the webview's toolbar.
  await vscode.commands.executeCommand('notifications.hideToasts');
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect
    .poll(async () => {
      const context = JSON.parse(
        (await row.getAttribute('data-vscode-context'))!,
      ) as { gitNativeUIGeneration: number; gitNativeUIRepositoryId: string };

      return context.gitNativeUIRepositoryId === repositoryId
        ? context.gitNativeUIGeneration
        : 0;
    })
    .toBeGreaterThan(previous.gitNativeUIGeneration);

  return row;
}
