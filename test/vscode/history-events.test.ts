import assert from 'node:assert/strict';

import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import { createFixture } from '../fixtures/repository';

describe('history subscriptions during native message review', () => {
  it('ignores repeated status checks while detecting a real new branch', async () => {
    const f = await createFixture({ prefix: 'git-native-ui history status ' });
    let adapter: GitAdapter | undefined;
    let subscription: vscode.Disposable | undefined;

    try {
      const access = await getGitApi();

      await access.api.openRepository(vscode.Uri.file(f.root));
      const id = vscode.Uri.file(f.root).toString();
      const repo = access.repository(id);

      await repo.status();
      adapter = await createGitAdapter();
      let changes = 0;

      subscription = adapter.subscribe(id, () => {
        changes++;
      });
      await repo.status();
      assert.equal(
        changes,
        0,
        'an unchanged Git status must not reset history or cancel a native draft',
      );
      await repo.createBranch('new-reference', false);
      await repo.status();
      await expect.poll(() => changes).toBeGreaterThan(0);
      const afterBranch = changes;

      await repo.status();
      assert.equal(changes, afterBranch);
    } finally {
      subscription?.dispose();
      adapter?.dispose();
      await f.dispose();
    }
  });
});
