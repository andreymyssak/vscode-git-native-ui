import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assert, expect, test } from 'vitest';

import type { GitRef } from '../../src/extension/git/api';
import { createOperations } from '../../src/extension/git/operations';
import { configureBranchRepository } from '../fixtures/branch-repository';
import { createSquashFixture } from '../fixtures/squash-repository';

async function fixture() {
  const f = await createSquashFixture();

  try {
    const repo = configureBranchRepository(f);
    const state = {
      HEAD: { type: 0 as const, name: 'main', commit: f.c },
      refs: [] as GitRef[],
      remotes: [],
      worktrees: [],
      mergeChanges: [],
      onDidChange: () => ({ dispose() {} }),
    };

    Object.defineProperty(repo, 'state', { value: state });
    repo.status = async () => {
      state.HEAD = {
        type: 0,
        name: (await f.runGit(['branch', '--show-current'])).trim(),
        commit: (await f.runGit(['rev-parse', 'HEAD'])).trim(),
      };
      state.refs = await repo.getRefs({});
    };

    await f.runGit(['branch', 'alpha', f.a]);
    await f.runGit(['branch', 'beta', f.a]);
    const run = createOperations(f.access, f.cli, {
      updateDiverged: async () => null,
      remoteCheckout: async () => null,
    });

    return { ...f, run };
  } catch (error) {
    await f.dispose();
    throw error;
  }
}

test('batch deletion restores every saved tip through one token without checkout or losing dirty work', async () => {
  const f = await fixture();

  try {
    const head = (await f.runGit(['rev-parse', 'HEAD'])).trim();

    await writeFile(join(f.root, 'local.txt'), 'Local work');
    const result = await f.run('fixture', {
      kind: 'delete-branches',
      branches: ['alpha', 'beta'].map((name) => ({
        refId: `refs/heads/${name}`,
        expectedSha: f.a,
      })),
    });

    expect(result.kind, JSON.stringify(result)).toBe('success');
    assert.ok(result.kind === 'success' && result.branchRestore);
    expect(result.branchRestore.names).toStrictEqual(['alpha', 'beta']);
    expect(
      (
        await f.runGit([
          'for-each-ref',
          '--format=%(refname)',
          'refs/heads/alpha',
          'refs/heads/beta',
        ])
      ).trim(),
    ).toBe('');
    const restored = await f.run('fixture', {
      kind: 'restore-branch',
      token: result.branchRestore.token,
    });

    expect(restored.kind, JSON.stringify(restored)).toBe('success');
    for (const name of ['alpha', 'beta'])
      expect((await f.runGit(['rev-parse', `refs/heads/${name}`])).trim()).toBe(
        f.a,
      );
    expect((await f.runGit(['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect(await f.runGit(['status', '--porcelain'])).toMatch(/local.txt/);
    expect(
      (
        await f.run('fixture', {
          kind: 'restore-branch',
          token: result.branchRestore.token,
        })
      ).kind,
    ).toBe('error');
  } finally {
    await f.dispose();
  }
});
test('one unmerged refusal preserves successful deletions and grouped Restore', async () => {
  const f = await fixture();

  try {
    const head = (await f.runGit(['rev-parse', 'HEAD'])).trim();
    const tree = (await f.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
    const unmerged = (
      await f.runGit(['commit-tree', tree, '-p', head, '-m', 'Unmerged'])
    ).trim();

    await f.runGit(['branch', 'unmerged', unmerged]);
    const result = await f.run('fixture', {
      kind: 'delete-branches',
      branches: [
        { refId: 'refs/heads/alpha', expectedSha: f.a },
        { refId: 'refs/heads/unmerged', expectedSha: unmerged },
        { refId: 'refs/heads/beta', expectedSha: f.a },
      ],
    });

    expect(result.kind, JSON.stringify(result)).toBe('error');
    assert.ok(result.kind === 'error' && result.branchRestore);
    expect(result.message).toMatch(/Deleted 2 branches/);
    expect(result.message).toMatch(/unmerged/);
    expect((await f.runGit(['rev-parse', 'refs/heads/unmerged'])).trim()).toBe(
      unmerged,
    );
    expect(
      (
        await f.run('fixture', {
          kind: 'restore-branch',
          token: result.branchRestore.token,
        })
      ).kind,
    ).toBe('success');
  } finally {
    await f.dispose();
  }
});
for (const scenario of [
  'stale',
  'current',
  'collision',
  'refresh',
  'worktree',
] as const)
  test(`batch deletion ${scenario} preserves unselected refs and recovery`, async () => {
    const f = await fixture();

    try {
      const repo = f.access.repository('fixture');
      const targets = ['alpha', 'beta'].map((name) => ({
        refId: `refs/heads/${name}`,
        expectedSha: f.a,
      }));

      if (scenario === 'stale') targets[1]!.expectedSha = f.b;
      if (scenario === 'current') {
        targets[1] = { refId: 'refs/heads/main', expectedSha: f.c };
      }

      if (scenario === 'worktree')
        await f.runGit(['worktree', 'add', join(f.directory, 'other'), 'beta']);
      const status = repo.status.bind(repo);
      let refreshes = 0;

      if (scenario === 'refresh')
        repo.status = async () => {
          if (++refreshes === 2) throw new Error('Refresh fixture failure');
          await status();
        };

      const deleted = await f.run('fixture', {
        kind: 'delete-branches',
        branches: targets,
      });

      if (scenario === 'stale' || scenario === 'current') {
        expect(deleted.kind, JSON.stringify(deleted)).toBe('error');
        for (const name of ['alpha', 'beta'])
          expect((await f.runGit(['rev-parse', name])).trim()).toBe(f.a);
      } else {
        assert.ok(
          (deleted.kind === 'success' || deleted.kind === 'error') &&
            deleted.branchRestore,
          JSON.stringify(deleted),
        );
        if (scenario === 'worktree') {
          expect(deleted.kind).toBe('error');
          expect(deleted.message!).toMatch(/beta/);
          expect((await f.runGit(['rev-parse', 'beta'])).trim()).toBe(f.a);
        }

        if (scenario === 'refresh')
          expect(deleted.message!).toMatch(/could not refresh/);
        if (scenario === 'collision') await f.runGit(['branch', 'beta', f.c]);
        const restored = await f.run('fixture', {
          kind: 'restore-branch',
          token: deleted.branchRestore.token,
        });

        if (scenario === 'collision') {
          expect(restored.kind).toBe('error');
          expect(
            (
              await f.runGit([
                'for-each-ref',
                '--format=%(refname)',
                'refs/heads/alpha',
              ])
            ).trim(),
          ).toBe('');
          expect((await f.runGit(['rev-parse', 'beta'])).trim()).toBe(f.c);
        } else {
          expect(restored.kind, JSON.stringify(restored)).toBe('success');
          expect((await f.runGit(['rev-parse', 'alpha'])).trim()).toBe(f.a);
          expect((await f.runGit(['rev-parse', 'beta'])).trim()).toBe(f.a);
        }
      }

      expect((await f.runGit(['rev-parse', 'HEAD'])).trim()).toBe(f.c);
      expect((await f.runGit(['rev-parse', 'retained-branch'])).trim()).toBe(
        f.a,
      );
      expect((await f.runGit(['rev-parse', 'retained-tag'])).trim()).toBe(f.b);
    } finally {
      await f.dispose();
    }
  });
test('a branch moved during a batch is preserved while earlier deletions remain restorable', async () => {
  const f = await fixture();

  try {
    const repo = f.access.repository('fixture');
    const deleteBranch = repo.deleteBranch.bind(repo);

    repo.deleteBranch = async (name, force) => {
      await deleteBranch(name, force);
      if (name === 'alpha')
        await f.runGit(['update-ref', 'refs/heads/beta', f.b, f.a]);
    };

    const deleted = await f.run('fixture', {
      kind: 'delete-branches',
      branches: ['alpha', 'beta'].map((name) => ({
        refId: `refs/heads/${name}`,
        expectedSha: f.a,
      })),
    });

    assert.ok(
      deleted.kind === 'error' && deleted.branchRestore,
      JSON.stringify(deleted),
    );
    expect(deleted.message).toMatch(/beta.*changed/);
    expect((await f.runGit(['rev-parse', 'beta'])).trim()).toBe(f.b);
    expect(
      (
        await f.run('fixture', {
          kind: 'restore-branch',
          token: deleted.branchRestore.token,
        })
      ).kind,
    ).toBe('success');
    expect((await f.runGit(['rev-parse', 'alpha'])).trim()).toBe(f.a);
  } finally {
    await f.dispose();
  }
});
test('queued batch deletion copies targets before waiting for another operation', async () => {
  const f = await fixture();

  try {
    const repo = f.access.repository('fixture');
    const getRefs = repo.getRefs.bind(repo);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let first = true;

    repo.getRefs = async (query) => {
      if (first) {
        first = false;
        entered();
        await waiting;
      }

      return getRefs(query);
    };

    const preceding = f.run('fixture', {
      kind: 'create-branch',
      name: 'preceding',
      refId: 'refs/heads/main',
      expectedSha: f.c,
    });

    await started;
    const branches = ['alpha', 'beta'].map((name) => ({
      refId: `refs/heads/${name}`,
      expectedSha: f.a,
    }));
    const queued = f.run('fixture', { kind: 'delete-branches', branches });

    branches[0]!.refId = 'refs/heads/main';
    branches[0]!.expectedSha = f.c;
    release();
    expect((await preceding).kind).toBe('success');
    const result = await queued;

    expect(result.kind, JSON.stringify(result)).toBe('success');
    expect(
      (
        await f.runGit([
          'for-each-ref',
          '--format=%(refname)',
          'refs/heads/alpha',
          'refs/heads/beta',
        ])
      ).trim(),
    ).toBe('');
    expect((await f.runGit(['rev-parse', 'main'])).trim()).toBe(f.c);
  } finally {
    await f.dispose();
  }
});
test('group Restore recovers remote and local tracking and rejects foreign or forged tokens', async () => {
  const f = await fixture();

  try {
    await f.runGit(['update-ref', 'refs/remotes/origin/main', f.a]);
    await f.runGit(['config', 'remote.origin.url', f.root]);
    await f.runGit([
      'config',
      'remote.origin.fetch',
      '+refs/heads/*:refs/remotes/origin/*',
    ]);
    await f.runGit(['branch', '--set-upstream-to=origin/main', 'alpha']);
    await f.runGit(['branch', '--set-upstream-to=main', 'beta']);
    const repo = f.access.repository('fixture');
    const getBranch = repo.getBranch.bind(repo);

    repo.getBranch = async (name) => ({
      ...(await getBranch(name)),
      upstream: name.endsWith('/alpha')
        ? { remote: 'origin', name: 'main' }
        : { remote: '.', name: 'main' },
    });
    repo.setBranchUpstream = async (name, upstream) => {
      await f.runGit(['branch', `--set-upstream-to=${upstream}`, '--', name]);
    };

    const deleted = await f.run('fixture', {
      kind: 'delete-branches',
      branches: ['alpha', 'beta'].map((name) => ({
        refId: `refs/heads/${name}`,
        expectedSha: f.a,
      })),
    });

    assert.ok(
      deleted.kind === 'success' && deleted.branchRestore,
      JSON.stringify(deleted),
    );
    const token = deleted.branchRestore.token;

    expect(
      (await f.run('other-repository', { kind: 'restore-branch', token })).kind,
    ).toBe('error');
    expect(
      (await f.run('fixture', { kind: 'restore-branch', token: 'forged' }))
        .kind,
    ).toBe('error');
    expect(
      (await f.run('fixture', { kind: 'restore-branch', token })).kind,
    ).toBe('success');
    for (const [name, upstream] of [
      ['alpha', 'origin/main'],
      ['beta', 'main'],
    ])
      expect(
        (
          await f.runGit(['rev-parse', '--abbrev-ref', `${name}@{upstream}`])
        ).trim(),
      ).toBe(upstream);
  } finally {
    await f.dispose();
  }
});
