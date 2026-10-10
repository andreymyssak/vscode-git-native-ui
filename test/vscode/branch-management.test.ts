import assert from 'node:assert/strict';

import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import { createFixture } from '../fixtures/repository';

describe('local branch management', () => {
  it('renames the selected branch without switching or overwriting another branch', async () => {
    const fixture = await createFixture({
      prefix: 'git-ui-native branch rename ',
    });
    let adapter: GitAdapter | undefined;

    try {
      const access = await getGitApi();

      await access.api.openRepository(vscode.Uri.file(fixture.root));
      adapter = await createGitAdapter();
      const id = vscode.Uri.file(fixture.root).toString();
      const head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

      await fixture.runGit(['branch', 'topic']);
      const result = await adapter.operate(id, {
        kind: 'rename-branch',
        refId: 'refs/heads/topic',
        expectedSha: head,
        name: 'feature/renamed',
      });

      assert.equal(result.kind, 'success');
      assert.equal(result.backend, 'cli');
      assert.equal(
        (await fixture.runGit(['branch', '--show-current'])).trim(),
        'main',
      );
      assert.equal(
        (
          await fixture.runGit(['rev-parse', 'refs/heads/feature/renamed'])
        ).trim(),
        head,
      );
      assert.ok(
        !(
          await fixture.runGit([
            'for-each-ref',
            '--format=%(refname)',
            'refs/heads',
          ])
        )
          .split('\n')
          .includes('refs/heads/topic'),
      );
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'rename-branch',
            refId: 'refs/heads/feature/renamed',
            expectedSha: head,
            name: 'main',
          })
        ).kind,
        'error',
      );
      assert.equal(
        (
          await fixture.runGit(['rev-parse', 'refs/heads/feature/renamed'])
        ).trim(),
        head,
      );
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'rename-branch',
            refId: 'refs/heads/main',
            expectedSha: head,
            name: 'current-renamed',
          })
        ).kind,
        'success',
      );
      assert.equal(
        (await fixture.runGit(['branch', '--show-current'])).trim(),
        'current-renamed',
      );
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'rename-branch',
            refId: 'refs/heads/feature/renamed',
            expectedSha: 'a'.repeat(40),
            name: 'stale',
          })
        ).kind,
        'error',
      );
      await fixture.runGit(['tag', 'example']);
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'rename-branch',
            refId: 'refs/tags/example',
            expectedSha: head,
            name: 'tag-renamed',
          })
        ).kind,
        'error',
      );
    } finally {
      adapter?.dispose();
      await fixture.dispose();
    }
  });

  it('deletes merged branches but preserves current, unmerged and worktree branches', async () => {
    const fixture = await createFixture({
      prefix: 'git-ui-native branch delete ',
    });
    let adapter: GitAdapter | undefined;

    try {
      const access = await getGitApi();

      await access.api.openRepository(vscode.Uri.file(fixture.root));
      adapter = await createGitAdapter();
      const id = vscode.Uri.file(fixture.root).toString();
      const head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

      await fixture.runGit(['branch', 'merged']);
      const result = await adapter.operate(id, {
        kind: 'delete-branch',
        refId: 'refs/heads/merged',
        expectedSha: head,
      });

      assert.equal(result.kind, 'success');
      assert.equal(result.backend, 'api');
      assert.ok(
        !(
          await fixture.runGit([
            'for-each-ref',
            '--format=%(refname)',
            'refs/heads',
          ])
        )
          .split('\n')
          .includes('refs/heads/merged'),
      );
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'delete-branch',
            refId: 'refs/heads/main',
            expectedSha: head,
          })
        ).kind,
        'error',
      );
      const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
      const unmerged = (
        await fixture.runGit([
          'commit-tree',
          tree,
          '-p',
          head,
          '-m',
          'Unmerged',
        ])
      ).trim();

      await fixture.runGit(['update-ref', 'refs/heads/unmerged', unmerged]);
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'delete-branch',
            refId: 'refs/heads/unmerged',
            expectedSha: unmerged,
          })
        ).kind,
        'error',
      );
      assert.equal(
        (await fixture.runGit(['rev-parse', 'refs/heads/unmerged'])).trim(),
        unmerged,
      );
      await fixture.runGit([
        'worktree',
        'add',
        '-b',
        'linked',
        fixture.root + '/owned-linked',
      ]);
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'delete-branch',
            refId: 'refs/heads/linked',
            expectedSha: head,
          })
        ).kind,
        'error',
      );
      assert.equal(
        (await fixture.runGit(['rev-parse', 'refs/heads/linked'])).trim(),
        head,
      );
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'delete-branch',
            refId: 'refs/heads/linked',
            expectedSha: 'a'.repeat(40),
          })
        ).kind,
        'error',
      );
      await fixture.runGit(['update-ref', 'refs/heads/-n10', head]);
      const literal = await adapter.operate(id, {
        kind: 'delete-branch',
        refId: 'refs/heads/-n10',
        expectedSha: head,
      });

      assert.equal(literal.kind, 'success');
      assert.equal(literal.backend, 'cli');
      assert.equal(
        (await fixture.runGit(['branch', '--show-current'])).trim(),
        'main',
      );
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
    } finally {
      adapter?.dispose();
      await fixture.dispose();
    }
  });
});
