import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import type { Frame } from '@playwright/test';
import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import { getGitApi } from '../../src/extension/git/api';
import { LOG_VIEW_ID } from '../../src/shared/extension-identity';
import { nativeBrowser, refreshNativeHistory } from '../fixtures/native-panel';
import { createFixture } from '../fixtures/repository';

describe('file activation gesture', () => {
  it('maximized panel remains stationary until the double-click opens one regular diff', async () => {
    const fixture = await createFixture({
      prefix: 'git-ui-native file gesture ',
    });
    const gitConfig = vscode.workspace.getConfiguration('git');
    const autoRefresh = gitConfig.inspect<boolean>('autorefresh')?.globalValue;

    try {
      // Keep the measured gesture independent of focus-triggered Git scans.
      await gitConfig.update(
        'autorefresh',
        false,
        vscode.ConfigurationTarget.Global,
      );
      const access = await getGitApi();
      const rootUri = vscode.Uri.file(fixture.root);

      await access.api.openRepository(rootUri);
      await access.repository(rootUri.toString()).status();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand(`${LOG_VIEW_ID}.focus`);
      const browser = await nativeBrowser();
      let frame: Frame | undefined;

      for (let attempt = 0; attempt < 100 && !frame; attempt++) {
        for (const context of browser.contexts())
          for (const page of context.pages())
            for (const candidate of page.frames())
              if (await candidate.locator('#branches').count())
                frame = candidate;
        if (!frame) await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(frame);
      await frame.page().bringToFront();
      await access.repository(rootUri.toString()).status();
      const row = await refreshNativeHistory(frame, rootUri.toString());

      await expect(row).toContainText('Initial');
      await expect(row).toHaveAttribute(
        'data-sha',
        (await fixture.runGit(['rev-parse', 'HEAD'])).trim(),
      );
      await row.click();
      const file = frame.locator(
        '#details[aria-busy="false"]:not([inert]) [data-path="sample.txt"]',
      );

      await expect(file).toBeVisible();
      await vscode.commands.executeCommand(
        'workbench.action.toggleMaximizedPanel',
      );
      await expect(file).toBeVisible();
      const before = await file.boundingBox();

      assert.ok(before);
      await file.evaluate((node) =>
        node.dispatchEvent(
          new MouseEvent('click', { bubbles: true, detail: 1 }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const afterFirstClick = await file.boundingBox();

      assert.ok(afterFirstClick);
      assert.ok(
        Math.abs(afterFirstClick.y - before.y) < 1,
        'the first pointer click must not move the row before a double-click can finish',
      );
      await file.evaluate((node) => {
        node.dispatchEvent(
          new MouseEvent('click', { bubbles: true, detail: 2 }),
        );
        node.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, detail: 2 }),
        );
      });
      const diffs = () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.input instanceof vscode.TabInputTextDiff);

      await expect.poll(() => diffs().length).toBe(1);
      assert.equal(diffs()[0]!.isPreview, false);
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(diffs().length, 1);
      assert.equal(diffs()[0]!.isPreview, false);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand(`${LOG_VIEW_ID}.focus`);
      await vscode.commands.executeCommand(
        'workbench.action.toggleMaximizedPanel',
      );
      assert.equal(vscode.window.visibleTextEditors.length, 0);
      await refreshNativeHistory(frame, rootUri.toString());
      await expect(file).toBeVisible();
      await file.evaluate((node) => {
        node.addEventListener(
          'click',
          (event) => {
            Object.assign(window, {
              gestureClick: {
                detail: (event as MouseEvent).detail,
                target: (event.target as HTMLElement).outerHTML,
              },
            });
          },
          { once: true, capture: true },
        );
      });
      await file.click();
      await expect
        .poll(() => diffs().length)
        .toBe(1)
        .catch(async (error: unknown) => {
          await writeFile(
            '.artifacts/file-gesture-diagnostic.json',
            JSON.stringify(
              {
                click: await frame!.evaluate(
                  () =>
                    (window as unknown as { gestureClick?: unknown })
                      .gestureClick,
                ),
                status: await frame!.locator('#status').textContent(),
                details: await frame!
                  .locator('#details')
                  .evaluate((node) => node.outerHTML),
                tabs: vscode.window.tabGroups.all.map((group) =>
                  group.tabs.map((tab) => ({
                    label: tab.label,
                    preview: tab.isPreview,
                  })),
                ),
              },
              null,
              2,
            ),
          );
          throw error;
        });
      assert.equal(diffs()[0]!.isPreview, true);
      await expect
        .poll(() =>
          vscode.window.visibleTextEditors.some(
            (editor) => editor.document.getText() === 'first\n',
          ),
        )
        .toBe(true);
    } finally {
      try {
        await vscode.commands.executeCommand(
          'workbench.action.closeAllEditors',
        );
      } finally {
        await Promise.all([
          fixture.dispose(),
          gitConfig.update(
            'autorefresh',
            autoRefresh,
            vscode.ConfigurationTarget.Global,
          ),
        ]);
      }
    }
  });
});
