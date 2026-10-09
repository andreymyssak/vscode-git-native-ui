import assert from 'node:assert/strict';

import type { Frame } from '@playwright/test';
import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import { getGitApi } from '../../src/extension/git/api';
import { nativeBrowser } from '../fixtures/native-panel';
import { createFixture } from '../fixtures/repository';

describe('actual panel', () => {
  it('native webview browses a branch without checkout and shows commit details', async () => {
    const fixture = await createFixture({ prefix: 'git-native-ui panel ' });
    let clipboard: string | undefined;

    try {
      const browser = await nativeBrowser();

      clipboard = await vscode.env.clipboard.readText();
      const head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
      const topic = (
        await fixture.runGit([
          'commit-tree',
          tree,
          '-p',
          head,
          '-m',
          'Topic commit',
        ])
      ).trim();

      await fixture.runGit(['update-ref', 'refs/heads/topic', topic]);
      await (
        await getGitApi()
      ).api.openRepository(vscode.Uri.file(fixture.root));
      await vscode.commands.executeCommand('gitNativeUI.log.focus');
      let frame: Frame | undefined;

      for (let attempt = 0; attempt < 100 && !frame; attempt++) {
        for (const context of browser.contexts())
          for (const page of context.pages())
            for (const candidate of page.frames())
              if (await candidate.locator('#branches').count())
                frame = candidate;
        if (!frame) await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(
        frame,
        'our compiled panel must be present in the native development window',
      );
      await expect(
        frame.getByRole('treeitem', { name: 'topic', exact: true }),
      ).toBeVisible();
      // CDP input cannot reach the locked macOS desktop. Dispatch into our
      // actual compiled native webview; pointer behavior is covered by Playwright.
      await frame
        .getByRole('treeitem', { name: 'topic', exact: true })
        .evaluate((node) =>
          node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
        );
      await expect(frame.locator('#scope')).toHaveText('topic');
      await expect(frame.locator('[data-commit-row]').first()).toContainText(
        'Topic commit',
      );
      await frame
        .getByRole('treeitem', { name: 'HEAD (Current Branch)', exact: true })
        .evaluate((node) =>
          node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
        );
      await expect(
        frame.locator('[data-commit-row]').first(),
      ).not.toContainText('Topic commit');
      await frame
        .getByRole('treeitem', { name: 'All branches', exact: true })
        .evaluate((node) =>
          node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
        );
      await expect(frame.locator('#scope')).toHaveText('All branches');
      await expect(frame.locator('[data-commit-row]').first()).toContainText(
        'Topic commit',
      );
      await frame
        .getByRole('treeitem', { name: 'topic', exact: true })
        .evaluate((node) =>
          node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
        );
      await expect(frame.locator('#scope')).toHaveText('topic');
      await expect(frame.locator('#history')).not.toHaveAttribute('inert', '');
      await frame
        .locator('[data-commit-row]')
        .first()
        .evaluate((node) => (node as HTMLElement).click());
      await expect(frame.locator('#details')).toContainText('Topic commit');
      const context = await frame
        .getByRole('treeitem', { name: 'topic', exact: true })
        .getAttribute('data-vscode-context');

      assert.ok(context);
      await vscode.commands.executeCommand(
        'gitNativeUI.copy-branch',
        JSON.parse(context),
      );
      assert.equal(await vscode.env.clipboard.readText(), 'topic');
      const commitContext = await frame
        .locator('[data-commit-row]')
        .first()
        .getAttribute('data-vscode-context');

      assert.ok(commitContext);
      await vscode.commands.executeCommand(
        'gitNativeUI.copy-sha',
        JSON.parse(commitContext),
      );
      assert.equal(await vscode.env.clipboard.readText(), topic);
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
      assert.equal(
        (await fixture.runGit(['branch', '--show-current'])).trim(),
        'main',
      );
    } finally {
      // Keep the native default context alive until the test driver closes it.
      await Promise.all([
        ...(clipboard !== undefined
          ? [vscode.env.clipboard.writeText(clipboard)]
          : []),
        fixture.dispose(),
      ]);
    }
  });
});
