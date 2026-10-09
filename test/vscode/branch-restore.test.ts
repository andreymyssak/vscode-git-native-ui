import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import { showBranchDeleted } from '../../src/extension/native/operation-feedback';
import type { OperationResult } from '../../src/shared/model';
import { nativeBrowser } from '../fixtures/native-panel';
import { createFixture } from '../fixtures/repository';

describe('deleted branch recovery with the installed Git API', () => {
  it('Restore recreates the deleted branch and upstream while retaining dirty work and checkout', async () => {
    const f = await createFixture({
      prefix: 'git-native-ui native branch restore ',
    });
    let adapter: GitAdapter | undefined;

    try {
      const access = await getGitApi();
      const head = (await f.runGit(['rev-parse', 'HEAD'])).trim();

      await f.runGit(['config', 'remote.origin.url', f.root]);
      await f.runGit([
        'config',
        'remote.origin.fetch',
        '+refs/heads/*:refs/remotes/origin/*',
      ]);
      await f.runGit(['update-ref', 'refs/remotes/origin/main', head]);
      await f.runGit(['branch', '--track', 'restore-me', 'origin/main']);
      await access.api.openRepository(vscode.Uri.file(f.root));
      const id = vscode.Uri.file(f.root).toString();

      adapter = await createGitAdapter();
      const deleted = await adapter.operate(id, {
        kind: 'delete-branch',
        refId: 'refs/heads/restore-me',
        expectedSha: head,
      });

      assert.ok(
        deleted.kind === 'success' && deleted.branchRestore,
        JSON.stringify(deleted),
      );
      await writeFile(join(f.root, 'local.txt'), 'Keep local work');
      const token = deleted.branchRestore.token;
      const resultPromise = new Promise<OperationResult>(
        (resolveResult, reject) => {
          showBranchDeleted('restore-me', async () => {
            try {
              resolveResult(
                await adapter!.operate(id, { kind: 'restore-branch', token }),
              );
            } catch (error) {
              reject(error);
            }
          });
        },
      );

      void resultPromise.catch(() => {});
      const browser = await nativeBrowser();
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) =>
          candidate.url().includes('/workbench/workbench.html'),
        );

      assert.ok(page);
      await vscode.commands.executeCommand('notifications.showList');
      const restore = page
        .getByRole('dialog', { name: /^Info: Deleted branch "restore-me"/ })
        .getByRole('button', { name: 'Restore', exact: true });

      await expect(restore).toBeVisible();
      await restore.evaluate((node) => (node as HTMLElement).click());
      const result = await resultPromise;

      assert.equal(result.kind, 'success', JSON.stringify(result));
      assert.equal((await f.runGit(['rev-parse', 'restore-me'])).trim(), head);
      assert.equal(
        (
          await f.runGit(['rev-parse', '--abbrev-ref', 'restore-me@{upstream}'])
        ).trim(),
        'origin/main',
      );
      assert.equal(
        (await f.runGit(['branch', '--show-current'])).trim(),
        'main',
      );
      assert.equal(
        await readFile(join(f.root, 'local.txt'), 'utf8'),
        'Keep local work',
      );
    } finally {
      try {
        await vscode.commands.executeCommand('notifications.clearAll');
        await vscode.commands.executeCommand('notifications.hideList');
      } finally {
        adapter?.dispose();
        await f.dispose();
      }
    }
  });
});
