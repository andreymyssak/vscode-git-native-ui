import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Frame } from '@playwright/test';
import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import { getGitApi } from '../../src/extension/git/api';
import { nativeBrowser, refreshNativeHistory } from '../fixtures/native-panel';
import { createFixture } from '../fixtures/repository';

declare global {
  interface Window {
    __fileLatencyClick: {
      at: number;
      path: string | null;
      connected: boolean;
      inert: boolean;
    } | null;
  }
}

describe('changed file opening latency', () => {
  it('opens cold file previews promptly while an editor is visible', async () => {
    const fixture = await createFixture({
      prefix: 'git-native-ui diff latency ',
    });
    const rootUri = vscode.Uri.file(fixture.root);
    const gitConfig = vscode.workspace.getConfiguration('git');
    const autoRefresh = gitConfig.inspect<boolean>('autorefresh')?.globalValue;

    try {
      // Measure editor activation in a quiet fixture; cancellation has its own cases.
      await gitConfig.update(
        'autorefresh',
        false,
        vscode.ConfigurationTarget.Global,
      );
      await writeFile(join(fixture.root, 'sample.txt'), 'second\n');
      await writeFile(join(fixture.root, 'another.txt'), 'another\n');
      await fixture.runGit(['add', '.']);
      await fixture.runGit(['commit', '-m', 'Latency sample']);
      const sha = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const access = await getGitApi();

      await access.api.openRepository(rootUri);
      await access.repository(rootUri.toString()).status();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.window.showTextDocument(
        vscode.Uri.file(join(fixture.root, '.gitignore')),
      );
      await vscode.commands.executeCommand('gitNativeUI.log.focus');
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

      await expect(row).toContainText('Latency sample');
      await expect(row).toHaveAttribute('data-sha', sha);
      await row.click();
      assert.ok(vscode.window.visibleTextEditors.length);
      for (const path of ['sample.txt', 'another.txt']) {
        const file = frame.locator(
          `#details[aria-busy="false"]:not([inert]) [data-path="${path}"]`,
        );
        const modifiedUri = access.api
          .toGitUri(vscode.Uri.joinPath(rootUri, path), sha)
          .toString();

        await expect(file).toBeVisible();
        let tabAt = 0;
        let contentAt = 0;
        const tabs = vscode.window.tabGroups.onDidChangeTabs(() => {
          tabAt ||= Date.now();
        });
        const content = vscode.window.onDidChangeVisibleTextEditors(
          (editors) => {
            if (
              editors.some(
                (editor) => editor.document.uri.toString() === modifiedUri,
              )
            )
              contentAt ||= Date.now();
          },
        );

        try {
          await frame.evaluate(() => {
            window.__fileLatencyClick = null;
            document.addEventListener(
              'click',
              (event) => {
                const node =
                  event.target instanceof Element
                    ? event.target.closest<HTMLElement>('[data-path]')
                    : null;

                window.__fileLatencyClick = {
                  at: Date.now(),
                  path: node?.getAttribute('data-path') ?? null,
                  connected: node?.isConnected ?? false,
                  inert: !!node?.closest('[inert]'),
                };
              },
              { capture: true, once: true },
            );
          });
          await file.click();
          const click: Window['__fileLatencyClick'] = await frame.evaluate(
            () => window.__fileLatencyClick,
          );

          assert.ok(click);
          assert.equal(click.path, path);
          assert.equal(click.connected, true);
          assert.equal(click.inert, false);
          const clickAt: number = click.at;

          await expect
            .poll(() => contentAt)
            .toBeGreaterThan(0)
            .catch(async (error: unknown) => {
              await writeFile(
                '.artifacts/file-latency-diagnostic.json',
                JSON.stringify(
                  {
                    path,
                    modifiedUri,
                    rootUri: access
                      .repository(rootUri.toString())
                      .rootUri.toString(),
                    click,
                    contentAt,
                    tabAt,
                    status: await frame!.locator('#status').textContent(),
                    details: await frame!
                      .locator('#details')
                      .evaluate((node) => node.outerHTML),
                    history: await frame!
                      .locator('#history')
                      .evaluate((node) => node.outerHTML),
                    editors: vscode.window.visibleTextEditors.map((editor) =>
                      editor.document.uri.toString(),
                    ),
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
          console.log(
            'DIFF_LATENCY',
            JSON.stringify({
              path,
              tabMs: tabAt - clickAt,
              contentMs: contentAt - clickAt,
            }),
          );
          assert.ok(
            contentAt - clickAt < 450,
            'a visible editor must not incur a double-click gesture wait',
          );
          const diff = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .find(
              (tab) =>
                tab.input instanceof vscode.TabInputTextDiff &&
                tab.input.modified.toString() === modifiedUri,
            );

          assert.equal(diff?.isPreview, true);
          const modified = vscode.window.visibleTextEditors.find(
            (editor) => editor.document.uri.toString() === modifiedUri,
          );

          assert.equal(
            modified?.document.getText(),
            path === 'sample.txt' ? 'second\n' : 'another\n',
          );
        } finally {
          tabs.dispose();
          content.dispose();
        }
      }

      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('gitNativeUI.log.focus');
      await vscode.commands.executeCommand(
        'workbench.action.toggleMaximizedPanel',
      );
      assert.equal(vscode.window.visibleTextEditors.length, 0);
      await frame
        .locator('[data-path="sample.txt"]')
        .evaluate((node) =>
          node.dispatchEvent(
            new MouseEvent('click', { bubbles: true, detail: 1 }),
          ),
        );
      await frame.locator('[data-path="another.txt"]').press('Enter');
      const diffs = () =>
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter((tab) => tab.input instanceof vscode.TabInputTextDiff);

      await expect.poll(() => diffs().length).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(
        diffs().length,
        1,
        'an older delayed preview cannot open after Enter activates another file',
      );
      const regular = diffs()[0]!;

      assert.ok(regular.input instanceof vscode.TabInputTextDiff);
      assert.equal(
        regular.input.modified.toString(),
        access.api
          .toGitUri(vscode.Uri.joinPath(rootUri, 'another.txt'), sha)
          .toString(),
      );
      assert.equal(regular.isPreview, false);
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
