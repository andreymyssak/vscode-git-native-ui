import assert from 'node:assert/strict';
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { divergentFixture } from '../fixtures/branch-update';

for (const mode of ['existing', 'new', 'remote', 'current'] as const) {
  it(`creates a ${mode} branch worktree without changing the original checkout or local edits`, async () => {
    const f = await divergentFixture('main');
    let adapter: GitAdapter | undefined;

    const path = f.root + '-worktree';
    const refId =
      mode === 'current'
        ? 'refs/heads/main'
        : mode === 'remote'
          ? 'refs/remotes/origin/feature'
          : 'refs/heads/feature';
    const source = mode === 'current' ? f.local : f.incoming;

    try {
      adapter = await createGitAdapter();
      await f.runGit(['update-ref', refId, source]);
      await writeFile(join(f.root, 'sample.txt'), 'staged edits\n');
      await f.runGit(['add', 'sample.txt']);
      await writeFile(join(f.root, 'untracked.txt'), 'unsaved edits\n');
      const before = await f.runGit(['status', '--porcelain', '-z']);
      const result = await adapter.operate(f.id, {
        kind: 'create-worktree',
        refId,
        expectedSha: source,
        path,
        name: mode === 'existing' ? null : 'feature-worktree',
      });

      assert.equal(result.kind, 'success', JSON.stringify(result));
      assert.equal(
        (await f.runGit(['-C', path, 'rev-parse', 'HEAD'])).trim(),
        source,
      );
      assert.equal(
        (await f.runGit(['-C', path, 'branch', '--show-current'])).trim(),
        mode === 'existing' ? 'feature' : 'feature-worktree',
      );
      if (mode !== 'current')
        assert.equal(
          await readFile(join(path, 'remote.txt'), 'utf8'),
          'remote change\n',
        );
      assert.equal(
        (await f.runGit(['branch', '--show-current'])).trim(),
        'main',
      );
      assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), f.local);
      assert.equal(await f.runGit(['status', '--porcelain', '-z']), before);
      assert.equal((await f.runGit(['rev-parse', refId])).trim(), source);
      if (mode === 'remote')
        assert.equal(
          (
            await f.runGit([
              'rev-parse',
              '--symbolic-full-name',
              'feature-worktree@{upstream}',
            ])
          ).trim(),
          refId,
        );
      assert.ok(
        (await adapter.worktrees(f.id)).some(
          (entry) =>
            entry.branch ===
            (mode === 'existing' ? 'feature' : 'feature-worktree'),
        ),
      );
    } finally {
      adapter?.dispose();
      await rm(path, { recursive: true, force: true });
      await f.dispose();
    }
  });
}

for (const reason of [
  'occupied branch',
  'existing path',
  'changed source',
  'relative path',
  'existing branch name',
] as const) {
  it(`worktree creation rejects ${reason} without replacing files or branch tips`, async () => {
    const f = await divergentFixture('main');
    let adapter: GitAdapter | undefined;

    const path = f.root + '-worktree';

    try {
      adapter = await createGitAdapter();
      await f.runGit(['branch', 'feature', f.incoming]);
      const refId =
        reason === 'occupied branch' ? 'refs/heads/main' : 'refs/heads/feature';
      const sha = reason === 'occupied branch' ? f.local : f.incoming;

      if (reason === 'existing path') await writeFile(path, 'keep this file');
      const result = await adapter.operate(f.id, {
        kind: 'create-worktree',
        refId,
        expectedSha: reason === 'changed source' ? f.base : sha,
        path: reason === 'relative path' ? 'relative-worktree' : path,
        name: reason === 'existing branch name' ? 'feature' : null,
      });

      assert.equal(result.kind, 'error', JSON.stringify(result));
      assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), f.local);
      assert.equal(
        (await f.runGit(['rev-parse', 'feature'])).trim(),
        f.incoming,
      );
      if (reason === 'existing path')
        assert.equal(await readFile(path, 'utf8'), 'keep this file');
      else await assert.rejects(lstat(path), { code: 'ENOENT' });
      assert.equal(
        (await f.runGit(['worktree', 'list', '--porcelain'])).split('worktree ')
          .length - 1,
        1,
      );
    } finally {
      adapter?.dispose();
      await rm(path, { recursive: true, force: true });
      await f.dispose();
    }
  });
}
