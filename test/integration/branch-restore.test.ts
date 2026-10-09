import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assert, expect, test } from 'vitest';

import { createOperations } from '../../src/extension/git/operations';
import { configureBranchRepository } from '../fixtures/branch-repository';
import { createSquashFixture } from '../fixtures/squash-repository';

for (const scenario of [
  'restore',
  'local upstream',
  'collision',
  'missing upstream',
  'refresh failure',
] as const) {
  test(`branch Restore ${scenario} uses the saved tip without checkout or overwriting`, async (t) => {
    const f = await createSquashFixture();

    t.onTestFinished(() => f.dispose());
    try {
      await f.runGit(['update-ref', 'refs/remotes/origin/main', f.a]);
      await f.runGit(['config', 'remote.origin.url', f.root]);
      await f.runGit([
        'config',
        'remote.origin.fetch',
        '+refs/heads/*:refs/remotes/origin/*',
      ]);
      await f.runGit([
        'branch',
        scenario === 'local upstream'
          ? '--set-upstream-to=main'
          : '--set-upstream-to=origin/main',
        'retained-branch',
      ]);
      const repo = configureBranchRepository(f);
      let refreshes = 0;

      repo.status = async () => {
        if (scenario === 'refresh failure' && refreshes++ === 0)
          throw new Error('Fixture refresh failed');
      };

      repo.getBranch = async () => ({
        type: 0,
        upstream: {
          remote: scenario === 'local upstream' ? '.' : 'origin',
          name: 'main',
        },
      });
      const run = createOperations(f.access, f.cli, {
        updateDiverged: async () => null,
        remoteCheckout: async () => null,
      });
      const deleted = await run('fixture', {
        kind: 'delete-branch',
        refId: 'refs/heads/retained-branch',
        expectedSha: f.a,
      });

      expect(deleted.kind, JSON.stringify(deleted)).toBe('success');
      assert.ok(deleted.kind === 'success' && deleted.branchRestore);
      if (scenario === 'refresh failure')
        expect(deleted.message ?? '').toMatch(/deleted.*refresh/i);
      const token = deleted.branchRestore.token;

      expect(
        (await run('other-repository', { kind: 'restore-branch', token })).kind,
      ).toBe('error');
      const head = (await f.runGit(['rev-parse', 'HEAD'])).trim();

      await writeFile(join(f.root, 'local.txt'), 'Untracked work');
      if (scenario === 'collision')
        await f.runGit(['branch', 'retained-branch', f.c]);
      if (scenario === 'missing upstream')
        await f.runGit(['update-ref', '-d', 'refs/remotes/origin/main']);
      const restored = await run('fixture', { kind: 'restore-branch', token });

      expect(restored.kind, JSON.stringify(restored)).toBe(
        ['restore', 'local upstream', 'refresh failure'].includes(scenario)
          ? 'success'
          : 'error',
      );
      expect((await f.runGit(['rev-parse', 'retained-branch'])).trim()).toBe(
        scenario === 'collision' ? f.c : f.a,
      );
      expect((await f.runGit(['rev-parse', 'HEAD'])).trim()).toBe(head);
      expect((await f.runGit(['branch', '--show-current'])).trim()).toBe(
        'main',
      );
      expect(await f.runGit(['status', '--porcelain'])).toBe('?? local.txt\n');
      if (scenario === 'restore')
        expect(
          (
            await f.runGit([
              'rev-parse',
              '--abbrev-ref',
              'retained-branch@{upstream}',
            ])
          ).trim(),
        ).toBe('origin/main');
      if (scenario === 'missing upstream') {
        assert.ok(restored.kind === 'error');
        expect(restored.message).toMatch(/Restored.*tracking/i);
      }

      expect(
        (await run('fixture', { kind: 'restore-branch', token })).kind,
      ).toBe('error');
      expect(
        (await run('fixture', { kind: 'restore-branch', token: 'forged' }))
          .kind,
      ).toBe('error');
    } finally {
      await f.dispose();
    }
  });
}
