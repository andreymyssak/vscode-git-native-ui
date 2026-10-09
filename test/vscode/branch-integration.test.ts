import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { divergentFixture } from '../fixtures/branch-update';

for (const method of ['merge', 'rebase'] as const) {
  for (const state of ['fast-forward', 'already integrated'] as const) {
    it(`${method} handles ${state} without creating extra commits or changing its source`, async () => {
      const f = await divergentFixture('main');
      let adapter: GitAdapter | undefined;

      try {
        adapter = await createGitAdapter();
        const source = state === 'fast-forward' ? f.incoming : f.base;

        if (state === 'fast-forward')
          await f.runGit(['reset', '--hard', f.base]);
        await f.runGit(['branch', 'feature', source]);
        await f.access.repository(f.id).status();
        const head = state === 'fast-forward' ? f.base : f.local;
        const result = await adapter.operate(f.id, {
          kind: `${method}-branch`,
          refId: 'refs/heads/feature',
          expectedSha: source,
          expectedBranch: 'main',
          expectedHeadSha: head,
        });

        assert.equal(result.kind, 'success', JSON.stringify(result));
        assert.equal(
          (await f.runGit(['rev-parse', 'HEAD'])).trim(),
          state === 'fast-forward' ? f.incoming : f.local,
        );
        assert.equal((await f.runGit(['rev-parse', 'feature'])).trim(), source);
        assert.equal(
          (await f.runGit(['branch', '--show-current'])).trim(),
          'main',
        );
      } finally {
        adapter?.dispose();
        await f.dispose();
      }
    });
  }

  for (const source of ['local', 'remote'] as const) {
    it(`${method} integrates the selected ${source} branch into main without moving its source`, async () => {
      const f = await divergentFixture('main');
      let adapter: GitAdapter | undefined;

      try {
        adapter = await createGitAdapter();
        const refId =
          source === 'local'
            ? 'refs/heads/feature'
            : 'refs/remotes/origin/feature';

        await f.runGit(['update-ref', refId, f.incoming]);
        const result = await adapter.operate(f.id, {
          kind: `${method}-branch`,
          refId,
          expectedSha: f.incoming,
          expectedBranch: 'main',
          expectedHeadSha: f.local,
        });

        assert.equal(result.kind, 'success', JSON.stringify(result));
        assert.equal(result.backend, 'api');
        assert.equal(
          (await f.runGit(['branch', '--show-current'])).trim(),
          'main',
        );
        const parents = (await f.runGit(['show', '-s', '--format=%P', 'HEAD']))
          .trim()
          .split(' ');

        assert.deepEqual(
          parents,
          method === 'merge' ? [f.local, f.incoming] : [f.incoming],
        );
        assert.equal((await f.runGit(['rev-parse', refId])).trim(), f.incoming);
        assert.equal(
          (await f.runGit(['rev-parse', 'origin/main'])).trim(),
          f.base,
        );
        assert.equal(
          await readFile(join(f.root, 'local.txt'), 'utf8'),
          'local change\n',
        );
        assert.equal(
          await readFile(join(f.root, 'remote.txt'), 'utf8'),
          'remote change\n',
        );
        assert.equal((await f.runGit(['stash', 'list'])).trim(), '');
      } finally {
        adapter?.dispose();
        await f.dispose();
      }
    });
  }

  it(`${method} keeps a conflict available for native resolution and manual Abort`, async () => {
    const f = await divergentFixture('main', true);
    let adapter: GitAdapter | undefined;

    try {
      adapter = await createGitAdapter();

      await f.runGit(['branch', 'feature', f.incoming]);
      const result = await adapter.operate(f.id, {
        kind: `${method}-branch`,
        refId: 'refs/heads/feature',
        expectedSha: f.incoming,
        expectedBranch: 'main',
        expectedHeadSha: f.local,
      });

      assert.equal(result.kind, 'conflict', JSON.stringify(result));
      assert.equal(result.backend, 'api');
      assert.equal(
        result.kind === 'conflict' ? result.recovery : null,
        'source-control',
      );
      assert.equal(
        (await f.runGit(['diff', '--name-only', '--diff-filter=U'])).trim(),
        'sample.txt',
      );
      await f.runGit([method, '--abort']);
      assert.equal(
        (await f.runGit(['branch', '--show-current'])).trim(),
        'main',
      );
      assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), f.local);
      assert.equal(
        (await f.runGit(['rev-parse', 'feature'])).trim(),
        f.incoming,
      );
    } finally {
      adapter?.dispose();
      await f.dispose();
    }
  });

  for (const reason of [
    'changed source',
    'changed checkout',
    'dirty',
    'detached',
    'tag',
    'same branch',
    'unfinished merge',
  ] as const) {
    it(`${method} rejects ${reason} without changing branch tips or local work`, async () => {
      const f = await divergentFixture('main');
      let adapter: GitAdapter | undefined;

      try {
        adapter = await createGitAdapter();

        await f.runGit(['branch', 'feature', f.incoming]);
        let refId = 'refs/heads/feature';
        let expectedSha = f.incoming;
        let expectedHeadSha = f.local;

        if (reason === 'changed source') expectedSha = f.base;
        if (reason === 'changed checkout') expectedHeadSha = f.base;
        if (reason === 'dirty') {
          await writeFile(join(f.root, 'sample.txt'), 'staged local work\n');
          await f.runGit(['add', 'sample.txt']);
          await writeFile(
            join(f.root, 'unsaved.txt'),
            'untracked local work\n',
          );
        }

        if (reason === 'detached') await f.runGit(['checkout', '--detach']);
        if (reason === 'tag') {
          await f.runGit(['tag', 'release', f.incoming]);
          refId = 'refs/tags/release';
        }

        if (reason === 'same branch') {
          refId = 'refs/heads/main';
          expectedSha = f.local;
        }

        if (reason === 'unfinished merge') {
          await f.runGit(['merge', '--no-commit', '--no-ff', 'feature']);
          assert.equal(
            (await f.runGit(['diff', '--name-only', '--diff-filter=U'])).trim(),
            '',
          );
        }

        const before = await f.runGit(['status', '--porcelain', '-z']);
        const result = await adapter.operate(f.id, {
          kind: `${method}-branch`,
          refId,
          expectedSha,
          expectedBranch: 'main',
          expectedHeadSha,
        });

        assert.equal(result.kind, 'error', JSON.stringify(result));
        if (reason === 'dirty' || reason === 'unfinished merge')
          assert.equal(
            result.kind === 'error' ? result.recovery : null,
            'source-control',
          );
        assert.equal((await f.runGit(['rev-parse', 'main'])).trim(), f.local);
        assert.equal(
          (await f.runGit(['rev-parse', 'feature'])).trim(),
          f.incoming,
        );
        assert.equal(await f.runGit(['status', '--porcelain', '-z']), before);
        assert.equal((await f.runGit(['stash', 'list'])).trim(), '');
        if (reason === 'unfinished merge') await f.runGit(['merge', '--abort']);
      } finally {
        adapter?.dispose();
        await f.dispose();
      }
    });
  }
}
