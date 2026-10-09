import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import type { OperationDialogs } from '../../src/extension/git/operations';
import { divergentFixture } from '../fixtures/branch-update';

for (const choice of ['merge', 'rebase', null] as const) {
  const branch = 'main';

  it(`Update ${branch} uses explicit ${choice ?? 'Cancel'} and preserves the original checkout`, async () => {
    const f = await divergentFixture(branch);
    let adapter: GitAdapter | undefined;

    try {
      let prompts = 0;
      const dialogs: OperationDialogs = {
        remoteCheckout: async () => null,
        updateDiverged: async (target) => {
          prompts++;
          assert.deepEqual(target, {
            branch,
            upstream: 'origin/main',
            currentBranch: 'main',
          });

          return choice;
        },
      };

      adapter = await createGitAdapter(dialogs);

      const result = await adapter.operate(f.id, f.action);

      assert.equal(
        result.kind,
        choice ? 'success' : 'cancelled',
        JSON.stringify(result),
      );
      assert.equal(prompts, 1);
      assert.equal(
        (await f.runGit(['symbolic-ref', '--short', 'HEAD'])).trim(),
        'main',
      );
      const tip = (await f.runGit(['rev-parse', branch])).trim();

      if (!choice) assert.equal(tip, f.local);
      else {
        const parents = (await f.runGit(['show', '-s', '--format=%P', tip]))
          .trim()
          .split(' ');

        assert.deepEqual(
          parents,
          choice === 'merge' ? [f.local, f.incoming] : [f.incoming],
        );
        assert.equal(
          (await f.runGit(['show', `${branch}:local.txt`])).trim(),
          'local change',
        );
        assert.equal(
          (await f.runGit(['show', `${branch}:remote.txt`])).trim(),
          'remote change',
        );
      }

      assert.equal(
        (await f.runGit(['--git-dir', f.remote, 'rev-parse', 'main'])).trim(),
        f.incoming,
      );
      assert.equal((await f.runGit(['stash', 'list'])).trim(), '');
      assert.equal(
        (await f.runGit(['status', '--porcelain', '-z'])).trim(),
        '',
      );
    } finally {
      adapter?.dispose();
      await f.dispose();
    }
  });
}

for (const choice of ['checkout', null] as const) {
  it(`Another divergent branch ${choice ?? 'Cancel'} never merges, rebases or restores a checkout`, async () => {
    const f = await divergentFixture('topic');
    let adapter: GitAdapter | undefined;

    try {
      let prompts = 0;

      adapter = await createGitAdapter({
        remoteCheckout: async () => null,
        updateDiverged: async (target) => {
          prompts++;
          assert.deepEqual(target, {
            branch: 'topic',
            upstream: 'origin/main',
            currentBranch: 'main',
          });

          return choice;
        },
      });

      const result = await adapter.operate(f.id, f.action);

      assert.equal(
        result.kind,
        choice ? 'success' : 'cancelled',
        JSON.stringify(result),
      );
      assert.equal(prompts, 1);
      assert.equal(
        (await f.runGit(['symbolic-ref', '--short', 'HEAD'])).trim(),
        choice ? 'topic' : 'main',
      );
      assert.equal(
        (await f.runGit(['rev-parse', 'HEAD'])).trim(),
        choice ? f.local : f.base,
      );
      assert.equal((await f.runGit(['rev-parse', 'topic'])).trim(), f.local);
      assert.equal((await f.runGit(['rev-parse', 'main'])).trim(), f.base);
      assert.equal(
        (await f.runGit(['rev-parse', 'origin/main'])).trim(),
        f.incoming,
      );
      assert.equal((await f.runGit(['stash', 'list'])).trim(), '');
      assert.equal(
        (await f.runGit(['status', '--porcelain', '-z'])).trim(),
        '',
      );
    } finally {
      adapter?.dispose();
      await f.dispose();
    }
  });
}

it('Another divergent branch fetches and offers checkout with local edits, but refuses to switch until they are saved', async () => {
  const f = await divergentFixture('topic');
  let adapter: GitAdapter | undefined;

  try {
    let prompts = 0;

    adapter = await createGitAdapter({
      remoteCheckout: async () => null,
      updateDiverged: async () => {
        prompts++;

        return 'checkout';
      },
    });

    await writeFile(join(f.root, 'sample.txt'), 'unsaved edits\n');
    const result = await adapter.operate(f.id, f.action);

    assert.equal(result.kind, 'error');
    assert.equal(
      result.kind === 'error' ? result.recovery : null,
      'source-control',
    );
    assert.equal(
      result.kind === 'error' ? result.message : '',
      'Commit or stash local changes before checking out "topic".',
    );
    assert.equal(prompts, 1);
    assert.equal(
      (await f.runGit(['symbolic-ref', '--short', 'HEAD'])).trim(),
      'main',
    );
    assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), f.base);
    assert.equal((await f.runGit(['rev-parse', 'topic'])).trim(), f.local);
    assert.equal(
      (await f.runGit(['rev-parse', 'origin/main'])).trim(),
      f.incoming,
    );
    assert.equal(
      await readFile(join(f.root, 'sample.txt'), 'utf8'),
      'unsaved edits\n',
    );
    assert.equal((await f.runGit(['stash', 'list'])).trim(), '');
  } finally {
    adapter?.dispose();
    await f.dispose();
  }
});

for (const choice of ['merge', 'rebase'] as const) {
  it(`Current Update retains a native ${choice} conflict for Source Control and manual Abort`, async () => {
    const f = await divergentFixture('main', true);
    let adapter: GitAdapter | undefined;

    try {
      adapter = await createGitAdapter({
        remoteCheckout: async () => null,
        updateDiverged: async () => choice,
      });

      const result = await adapter.operate(f.id, f.action);

      assert.equal(result.kind, 'conflict', JSON.stringify(result));
      assert.equal(
        result.kind === 'conflict' ? result.message : null,
        'Git found conflicts. Resolve them in Source Control.',
      );
      assert.equal(
        result.kind === 'conflict' ? result.recovery : null,
        'source-control',
      );
      assert.equal(result.backend, 'api');
      assert.equal((await f.runGit(['rev-parse', 'main'])).trim(), f.local);
      assert.equal(
        (await f.runGit(['diff', '--name-only', '--diff-filter=U'])).trim(),
        'sample.txt',
      );
      const repo = f.access.repository(f.id);

      assert.equal(repo.state.mergeChanges.length, 1);
      if (choice === 'merge') {
        assert.equal(
          (await f.runGit(['symbolic-ref', '--short', 'HEAD'])).trim(),
          'main',
        );
        assert.equal(
          (await f.runGit(['rev-parse', 'MERGE_HEAD'])).trim(),
          f.incoming,
        );
        await f.runGit(['merge', '--abort']);
      } else {
        const headName = (
          await f.runGit([
            'rev-parse',
            '--path-format=absolute',
            '--git-path',
            'rebase-merge/head-name',
          ])
        ).trim();

        assert.equal(
          (await readFile(headName, 'utf8')).trim(),
          'refs/heads/main',
        );
        await f.runGit(['rebase', '--abort']);
      }

      assert.equal((await f.runGit(['rev-parse', 'main'])).trim(), f.local);
      assert.equal(
        (await f.runGit(['symbolic-ref', '--short', 'HEAD'])).trim(),
        'main',
      );
      assert.equal(
        (await f.runGit(['status', '--porcelain', '-z'])).trim(),
        '',
      );
      assert.equal((await f.runGit(['stash', 'list'])).trim(), '');
    } finally {
      adapter?.dispose();
      await f.dispose();
    }
  });
}

it('Update refuses an occupied branch and its detached in-progress rebase in another worktree', async () => {
  const f = await divergentFixture('topic', true);
  let adapter: GitAdapter | undefined;
  const path = f.root + '-worktree';

  try {
    adapter = await createGitAdapter({
      remoteCheckout: async () => null,
      updateDiverged: async () =>
        assert.fail('No choice for an occupied branch'),
    });

    await f.runGit(['worktree', 'add', path, 'topic']);
    const occupied = await adapter.operate(f.id, f.action);

    assert.equal(occupied.kind, 'error');
    assert.match(
      occupied.kind === 'error' ? occupied.message : '',
      /another worktree/,
    );
    await f.runGit(['fetch', 'origin']);
    await assert.rejects(() => f.runGit(['-C', path, 'rebase', f.incoming]));
    const rebasing = await adapter.operate(f.id, f.action);

    assert.equal(rebasing.kind, 'error');
    assert.match(
      rebasing.kind === 'error' ? rebasing.message : '',
      /being rebased in another worktree/,
    );
    assert.equal((await f.runGit(['rev-parse', 'topic'])).trim(), f.local);
    await f.runGit(['-C', path, 'rebase', '--abort']);
    const tree = (await f.runGit(['rev-parse', 'topic^{tree}'])).trim();
    const middle = (
      await f.runGit([
        'commit-tree',
        tree,
        '-p',
        f.local,
        '-m',
        'Bisect middle',
      ])
    ).trim();
    const last = (
      await f.runGit(['commit-tree', tree, '-p', middle, '-m', 'Bisect last'])
    ).trim();

    await f.runGit(['-C', path, 'reset', '--hard', last]);
    await f.runGit(['-C', path, 'bisect', 'start', last, f.base]);
    await assert.rejects(() =>
      f.runGit(['-C', path, 'symbolic-ref', '--quiet', 'HEAD']),
    );
    const bisecting = await adapter.operate(f.id, {
      ...f.action,
      expectedSha: last,
    });

    assert.equal(bisecting.kind, 'error');
    assert.match(
      bisecting.kind === 'error' ? bisecting.message : '',
      /being bisected in another worktree/,
    );
    assert.equal((await f.runGit(['rev-parse', 'topic'])).trim(), last);
    await f.runGit(['-C', path, 'bisect', 'reset']);
    await f.runGit(['worktree', 'remove', path]);
  } finally {
    adapter?.dispose();
    await f.dispose();
    await rm(path, { recursive: true, force: true });
  }
});

it('Explicit checkout leaves a detached HEAD on the selected branch and preserves a branch named after the original SHA', async () => {
  const f = await divergentFixture('topic');
  let adapter: GitAdapter | undefined;

  try {
    adapter = await createGitAdapter({
      remoteCheckout: async () => null,
      updateDiverged: async (target) => {
        assert.equal(target.currentBranch, null);

        return 'checkout';
      },
    });

    await f.runGit(['branch', f.base, f.incoming]);
    await f.runGit(['switch', '--detach', `${f.base}^{commit}`]);
    const result = await adapter.operate(f.id, f.action);

    assert.equal(result.kind, 'success', JSON.stringify(result));
    assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), f.local);
    assert.equal(
      (await f.runGit(['symbolic-ref', '--short', 'HEAD'])).trim(),
      'topic',
    );
    assert.equal(
      (await f.runGit(['rev-parse', `refs/heads/${f.base}`])).trim(),
      f.incoming,
    );
  } finally {
    adapter?.dispose();
    await f.dispose();
  }
});

it('Update follows an existing local upstream without fetching into its checked-out branch', async () => {
  const f = await divergentFixture('topic');
  let adapter: GitAdapter | undefined;

  try {
    adapter = await createGitAdapter({
      remoteCheckout: async () => null,
      updateDiverged: async () => assert.fail('This is a local fast-forward'),
    });

    await f.runGit(['reset', '--hard', f.incoming]);
    await f.runGit(['update-ref', 'refs/heads/topic', f.base]);
    await f.runGit(['config', 'branch.topic.remote', '.']);
    await f.runGit(['config', 'branch.topic.merge', 'refs/heads/main']);
    const refs = await adapter.references(f.id);

    assert.equal(
      refs.find((ref) => ref.id === 'refs/heads/topic')?.tracking?.upstream,
      'refs/heads/main',
    );
    const result = await adapter.operate(f.id, {
      ...f.action,
      expectedSha: f.base,
      expectedUpstream: 'refs/heads/main',
    });

    assert.equal(result.kind, 'success', JSON.stringify(result));
    assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), f.incoming);
    assert.equal(
      (await f.runGit(['symbolic-ref', '--short', 'HEAD'])).trim(),
      'main',
    );
    assert.equal((await f.runGit(['rev-parse', 'topic'])).trim(), f.incoming);
    assert.equal((await f.runGit(['status', '--porcelain', '-z'])).trim(), '');
  } finally {
    adapter?.dispose();
    await f.dispose();
  }
});
