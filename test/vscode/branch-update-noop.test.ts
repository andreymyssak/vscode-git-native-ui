import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { divergentFixture } from '../fixtures/branch-update';

for (const state of ['equal', 'ahead'] as const) {
  it(`Current ${state} Update fetches with staged, unstaged and untracked edits intact`, async () => {
    const f = await divergentFixture('main');
    let adapter: GitAdapter | undefined;

    try {
      const upstream = state === 'equal' ? f.local : f.base;

      adapter = await createGitAdapter({
        remoteCheckout: async () => null,
        updateDiverged: async () =>
          assert.fail('A no-op does not need a strategy'),
      });

      await f.runGit([
        '--git-dir',
        f.remote,
        'fetch',
        f.root,
        `${f.local}:refs/heads/noop-local`,
      ]);
      await f.runGit([
        '--git-dir',
        f.remote,
        'update-ref',
        'refs/heads/main',
        upstream,
      ]);
      await writeFile(join(f.root, 'sample.txt'), 'staged edit\n');
      await f.runGit(['add', 'sample.txt']);
      await writeFile(join(f.root, 'sample.txt'), 'unstaged edit\n');
      await writeFile(join(f.root, 'untracked.txt'), 'untracked edit\n');
      const index = await f.runGit(['diff', '--cached', '--binary']);
      const worktree = await f.runGit(['diff', '--binary']);
      const status = await f.runGit([
        'status',
        '--porcelain',
        '--untracked-files=all',
      ]);
      const result = await adapter.operate(f.id, f.action);

      assert.deepEqual(result, {
        kind: 'success',
        backend: 'cli',
        message: '"main" is already up to date.',
      });
      assert.equal(
        (await f.runGit(['rev-parse', 'origin/main'])).trim(),
        upstream,
      );
      assert.match(
        await readFile(join(f.root, '.git', 'FETCH_HEAD'), 'utf8'),
        new RegExp(upstream),
      );
      assert.equal(
        (await f.runGit(['symbolic-ref', '--short', 'HEAD'])).trim(),
        'main',
      );
      assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), f.local);
      assert.equal(await f.runGit(['diff', '--cached', '--binary']), index);
      assert.equal(await f.runGit(['diff', '--binary']), worktree);
      assert.equal(
        await f.runGit(['status', '--porcelain', '--untracked-files=all']),
        status,
      );
      assert.equal(
        await readFile(join(f.root, 'untracked.txt'), 'utf8'),
        'untracked edit\n',
      );
      assert.equal((await f.runGit(['stash', 'list'])).trim(), '');
      assert.equal(
        (await f.runGit(['--git-dir', f.remote, 'rev-parse', 'main'])).trim(),
        upstream,
      );
    } finally {
      adapter?.dispose();
      await f.dispose();
    }
  });
}

it('A clean unfinished merge blocks Update, preserves recovery state and offers Source Control', async () => {
  const f = await divergentFixture('main');
  let adapter: GitAdapter | undefined;
  let merging = false;

  try {
    adapter = await createGitAdapter({
      remoteCheckout: async () => null,
      updateDiverged: async () =>
        assert.fail('An unfinished operation cannot start another Update'),
    });

    const tree = (await f.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
    const other = (
      await f.runGit([
        'commit-tree',
        tree,
        '-p',
        f.base,
        '-m',
        'Same-tree divergence',
      ])
    ).trim();

    await f.runGit(['merge', '--no-ff', '--no-commit', other]);
    merging = true;
    assert.equal(
      await f.runGit(['status', '--porcelain', '--untracked-files=all']),
      '',
    );
    const fetched = await readFile(join(f.root, '.git', 'FETCH_HEAD'), 'utf8');
    const result = await adapter.operate(f.id, f.action);

    assert.equal(result.kind, 'error');
    if (result.kind !== 'error') assert.fail(JSON.stringify(result));
    assert.equal(result.recovery, 'source-control');
    assert.equal(
      result.message,
      'Finish the current Git operation (merge) in Source Control before updating.',
    );
    assert.equal((await f.runGit(['rev-parse', 'MERGE_HEAD'])).trim(), other);
    assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), f.local);
    assert.equal((await f.runGit(['rev-parse', 'origin/main'])).trim(), f.base);
    assert.equal(
      await readFile(join(f.root, '.git', 'FETCH_HEAD'), 'utf8'),
      fetched,
    );
    assert.equal(
      await f.runGit(['status', '--porcelain', '--untracked-files=all']),
      '',
    );
    assert.equal((await f.runGit(['stash', 'list'])).trim(), '');
  } finally {
    if (merging) await f.runGit(['merge', '--abort']);
    adapter?.dispose();
    await f.dispose();
  }
});
