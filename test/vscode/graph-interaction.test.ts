import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, type Frame } from '@playwright/test';
import * as vscode from 'vscode';

import { getGitApi } from '../../src/extension/git/api';
import { nativeBrowser, refreshNativeHistory } from '../fixtures/native-panel';
import { createFixture } from '../fixtures/repository';

describe('native graph interactions', () => {
  it('marks the checkout and opens details through graph dots without a hover popup', async () => {
    const fixture = await createFixture({
      prefix: 'git-native-ui graph hover ',
    });
    const rootUri = vscode.Uri.file(fixture.root);

    try {
      await writeFile(join(fixture.root, 'sample.txt'), 'graph update\n');
      await fixture.runGit(['add', '.']);
      await fixture.runGit([
        'commit',
        '-m',
        'Graph hover subject',
        '-m',
        'Full commit body',
      ]);
      const headSha = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const parentSha = (await fixture.runGit(['rev-parse', 'HEAD^'])).trim();
      const access = await getGitApi();

      await access.api.openRepository(rootUri);
      await access.repository(rootUri.toString()).status();
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
      const head = await refreshNativeHistory(frame, rootUri.toString());

      await expect(head).toHaveAttribute('data-sha', headSha);
      await expect(head.locator('svg circle')).toHaveCount(2);
      const parent = frame.locator(
        `[data-commit-row][data-sha="${parentSha}"]`,
      );

      await head.press('ArrowDown');
      await expect(parent).toBeFocused();
      await frame.page().keyboard.press('ArrowUp');
      await expect(head).toBeFocused();
      await expect(head).toHaveAccessibleDescription(/Current checkout/);
      await head.locator('[data-commit-graph]').hover();
      await expect(frame.getByRole('tooltip')).toHaveCount(0);
      await head.locator('[data-commit-graph]').click();
      await expect(head).toHaveAttribute('aria-selected', 'true');
      await expect(frame.locator('#details')).toContainText('sample.txt');
      await expect(frame.locator('#details')).toContainText('Full commit body');
      await expect(frame.locator('#details')).toContainText(
        'fixture@example.test',
      );
      await parent.locator('[data-commit-graph]').click();
      await expect(parent).toHaveAttribute('aria-selected', 'true');
      await expect(head).toHaveAttribute('aria-selected', 'false');
      await expect(head.locator('svg circle')).toHaveCount(2);
      assert.equal(
        (await fixture.runGit(['rev-parse', 'HEAD'])).trim(),
        headSha,
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await fixture.dispose();
    }
  });
});
