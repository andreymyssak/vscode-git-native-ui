import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import type { Fixture } from '../fixtures/repository';
import { createFixture } from '../fixtures/repository';

async function withRepository(
  run: (
    fixture: Fixture,
    adapter: GitAdapter,
    id: string,
    base: string,
  ) => Promise<void>,
) {
  const fixture = await createFixture({
    prefix: 'git-ui-native commit actions ',
  });
  let adapter: GitAdapter | undefined;

  try {
    adapter = await createGitAdapter();
    const id = vscode.Uri.file(fixture.root).toString();

    await (await getGitApi()).api.openRepository(vscode.Uri.file(fixture.root));
    await run(
      fixture,
      adapter,
      id,
      (await fixture.runGit(['rev-parse', 'HEAD'])).trim(),
    );
  } finally {
    adapter?.dispose();
    await fixture.dispose();
  }
}

async function commit(
  fixture: Fixture,
  path: string,
  text: string,
  message: string,
) {
  await writeFile(join(fixture.root, path), text);
  await fixture.runGit(['add', path]);
  await fixture.runGit(['commit', '-m', message]);

  return (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
}

describe('commit action execution through installed Git API', () => {
  for (const kind of ['branch-from-commit', 'tag-from-commit'] as const) {
    it(`${kind} creates at an older commit without checkout or publishing and refuses collisions`, async () => {
      await withRepository(async (f, adapter, id, base) => {
        const head = await commit(f, 'sample.txt', 'new\n', 'Newest');
        const before = await f.runGit(['status', '--porcelain']);
        const result = await adapter.operate(id, {
          kind,
          sha: base,
          name: 'chosen/ref',
        });
        const ref = `${kind === 'branch-from-commit' ? 'refs/heads' : 'refs/tags'}/chosen/ref`;

        assert.equal(result.kind, 'success');
        assert.equal(result.backend, 'api');
        assert.equal((await f.runGit(['rev-parse', ref])).trim(), base);
        assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), head);
        assert.equal(
          (await f.runGit(['branch', '--show-current'])).trim(),
          'main',
        );
        assert.equal(await f.runGit(['status', '--porcelain']), before);
        assert.equal(
          (await adapter.operate(id, { kind, sha: head, name: 'chosen/ref' }))
            .kind,
          'error',
        );
        assert.equal((await f.runGit(['rev-parse', ref])).trim(), base);
        assert.equal(
          (await adapter.operate(id, { kind, sha: base, name: '--force' }))
            .kind,
          'error',
        );
        assert.equal(
          (
            await adapter.operate(id, {
              kind,
              sha: 'f'.repeat(40),
              name: 'missing',
            })
          ).kind,
          'error',
        );
      });
    });
  }

  it('multi-pick applies dependent commits in one sequence without adding unselected history', async () => {
    await withRepository(async (f, adapter, id, base) => {
      const first = await commit(
        f,
        'sample.txt',
        'first change\n',
        'First picked',
      );
      const second = await commit(
        f,
        'sample.txt',
        'dependent change\n',
        'Second picked',
      );

      await f.runGit(['checkout', '-b', 'target', base]);
      const result = await adapter.operate(id, {
        kind: 'cherry-pick-commits',
        target: {
          shas: [first, second],
          expectedBranch: 'target',
          expectedHeadSha: base,
        },
      });

      assert.equal(result.kind, 'success');
      assert.equal(
        await f.runGit(['show', 'HEAD:sample.txt']),
        'dependent change\n',
      );
      assert.equal(
        (await f.runGit(['rev-list', '--count', `${base}..HEAD`])).trim(),
        '2',
      );
      assert.equal(
        (
          await f.runGit(['log', '--format=%s', '--reverse', `${base}..HEAD`])
        ).trim(),
        'First picked\nSecond picked',
      );
      assert.equal((await f.runGit(['rev-parse', 'main'])).trim(), second);
    });
  });

  for (const finish of ['abort', 'continue'] as const) {
    it(`a stopped multi-pick preserves the sequence for ${finish === 'abort' ? 'native Abort' : 'Git Continue'}`, async () => {
      await withRepository(async (f, adapter, id, base) => {
        const first = await commit(f, 'new.txt', 'picked\n', 'First');
        const second = await commit(f, 'sample.txt', 'source\n', 'Conflicting');
        const third = await commit(f, 'last.txt', 'last\n', 'Last');

        await f.runGit(['checkout', '-b', 'target', base]);
        const targetHead = await commit(f, 'sample.txt', 'target\n', 'Target');
        const result = await adapter.operate(id, {
          kind: 'cherry-pick-commits',
          target: {
            shas: [first, second, third],
            expectedBranch: 'target',
            expectedHeadSha: targetHead,
          },
        });

        assert.equal(result.kind, 'conflict');
        assert.equal(
          result.kind === 'conflict' ? result.recovery : null,
          'source-control',
        );
        assert.equal(
          (await f.runGit(['rev-parse', 'CHERRY_PICK_HEAD'])).trim(),
          second,
        );
        assert.equal(await f.runGit(['show', 'HEAD:new.txt']), 'picked\n');
        if (finish === 'abort') {
          await vscode.commands.executeCommand(
            'git.cherryPickAbort',
            vscode.Uri.file(f.root),
          );
          assert.equal(
            (await f.runGit(['rev-parse', 'HEAD'])).trim(),
            targetHead,
          );
        } else {
          await writeFile(join(f.root, 'sample.txt'), 'resolved\n');
          await f.runGit(['add', 'sample.txt']);
          await f.runGit([
            '-c',
            'core.editor=true',
            'cherry-pick',
            '--continue',
          ]);
          assert.equal(await f.runGit(['show', 'HEAD:last.txt']), 'last\n');
        }

        assert.equal(await f.runGit(['status', '--porcelain']), '');
      });
    });
  }

  it('an empty picked commit stops without retrying and keeps native Abort available', async () => {
    await withRepository(async (f, adapter, id, base) => {
      await f.runGit(['commit', '--allow-empty', '-m', 'Empty']);
      const empty = (await f.runGit(['rev-parse', 'HEAD'])).trim();

      await f.runGit(['checkout', '-b', 'target', base]);
      const result = await adapter.operate(id, {
        kind: 'cherry-pick-commits',
        target: {
          shas: [empty],
          expectedBranch: 'target',
          expectedHeadSha: base,
        },
      });

      assert.equal(result.kind, 'error');
      assert.equal(
        result.kind === 'error' ? result.recovery : null,
        'source-control',
      );
      assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), base);
      assert.equal(
        (await f.runGit(['rev-parse', 'CHERRY_PICK_HEAD'])).trim(),
        empty,
      );
      await vscode.commands.executeCommand(
        'git.cherryPickAbort',
        vscode.Uri.file(f.root),
      );
      assert.equal(await f.runGit(['status', '--porcelain']), '');
    });
  });

  it('Drop restores the surviving commit while preserving other branches and tags', async () => {
    await withRepository(async (f, adapter, id, base) => {
      const first = await commit(f, 'sample.txt', 'first changed\n', 'First');
      const head = await commit(f, 'sample.txt', 'last\n', 'Last');

      await f.runGit(['branch', 'retained', head]);
      await f.runGit(['tag', 'retained', first]);
      const result = await adapter.operate(id, {
        kind: 'drop-commits',
        target: {
          shas: [head, first],
          expectedBranch: 'main',
          expectedHeadSha: head,
        },
      });

      assert.equal(result.kind, 'success');
      assert.equal(
        result.kind === 'success' ? result.replacementSha : null,
        base,
      );
      assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), base);
      assert.equal(await f.runGit(['show', 'HEAD:sample.txt']), 'first\n');
      assert.equal(
        (await f.runGit(['rev-parse', 'refs/heads/retained'])).trim(),
        head,
      );
      assert.equal(
        (await f.runGit(['rev-parse', 'refs/tags/retained'])).trim(),
        first,
      );
      assert.equal(await f.runGit(['status', '--porcelain']), '');
    });
  });
});
