import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import type { Fixture } from '../fixtures/repository';
import { createFixture } from '../fixtures/repository';

describe('explicit Git operations', () => {
  let fixtures: Fixture[] = [];
  let temporaryAdapters: GitAdapter[] = [];
  let adapter: GitAdapter;
  let id: string;
  let original: string;

  beforeEach(async () => {
    fixtures = [];
    temporaryAdapters = [];
    for (const name of ['operations', 'other', 'remote-a', 'remote-b'])
      fixtures.push(await createFixture({ prefix: `git-ui-native ${name} ` }));
    const first = fixtures[0]!;
    const access = await getGitApi();

    for (const f of fixtures)
      await access.api.openRepository(vscode.Uri.file(f.root));
    adapter = await createGitAdapter();
    id = vscode.Uri.file(first.root).toString();
    original = (await first.runGit(['rev-parse', 'HEAD'])).trim();
  });
  afterEach(async () => {
    adapter?.dispose();
    for (const temporary of temporaryAdapters) temporary.dispose();
    await Promise.all([
      ...(fixtures[0]
        ? [rm(fixtures[0].root + '.linked', { recursive: true, force: true })]
        : []),
      ...fixtures.map((fixture) => fixture.dispose()),
    ]);
  });
  it('checkout targets selected repository and create branch leaves HEAD unchanged', async () => {
    const f = fixtures[0]!;
    const other = fixtures[1]!;
    const otherHead = await other.runGit(['rev-parse', 'HEAD']);

    await f.runGit(['branch', 'topic']);
    assert.equal(
      (
        await adapter.operate(id, {
          kind: 'checkout',
          refId: 'refs/heads/topic',
          expectedSha: original,
        })
      ).kind,
      'success',
    );
    assert.equal(
      (await f.runGit(['branch', '--show-current'])).trim(),
      'topic',
    );
    assert.equal(await other.runGit(['rev-parse', 'HEAD']), otherHead);
    assert.equal(
      (
        await adapter.operate(id, {
          kind: 'create-branch',
          refId: 'refs/heads/main',
          expectedSha: original,
          name: 'created',
        })
      ).kind,
      'success',
    );
    assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), original);
    assert.equal(
      (await f.runGit(['branch', '--show-current'])).trim(),
      'topic',
    );
    await f.runGit(['update-ref', 'refs/heads/-n10', original]);
    assert.equal(
      (
        await adapter.operate(id, {
          kind: 'checkout',
          refId: 'refs/heads/-n10',
          expectedSha: original,
        })
      ).kind,
      'success',
    );
    assert.equal((await f.runGit(['branch', '--show-current'])).trim(), '-n10');
    await f.runGit(['checkout', 'topic']);
  });
  it('Fetch All updates two local fixture remotes', async () => {
    const f = fixtures[0]!;

    for (const [index, name] of [
      [2, 'alpha'],
      [3, 'beta'],
    ] as const) {
      const remote = fixtures[index]!;

      await remote.runGit(['commit', '--allow-empty', '-m', name]);
      await f.runGit(['remote', 'add', name, remote.root]);
    }

    await (await getGitApi()).repository(id).status();
    assert.equal(
      (await adapter.operate(id, { kind: 'fetch-all' })).kind,
      'success',
    );
    for (const [index, name] of [
      [2, 'alpha'],
      [3, 'beta'],
    ] as const)
      assert.equal(
        await f.runGit(['rev-parse', `refs/remotes/${name}/main`]),
        await fixtures[index]!.runGit(['rev-parse', 'HEAD']),
      );
  });
  it('remote checkout creates a tracking branch and cancellation writes nothing', async () => {
    const f = fixtures[0]!;

    await f.runGit(['branch', 'topic']);
    await f.runGit(['remote', 'add', 'alpha', fixtures[2]!.root]);
    await f.runGit(['fetch', 'alpha']);
    const refId = 'refs/remotes/alpha/main';
    const sha = (await f.runGit(['rev-parse', refId])).trim();
    const cancelled = await createGitAdapter({
      updateDiverged: async () => null,
      remoteCheckout: async () => null,
    });

    temporaryAdapters.push(cancelled);
    const before = await f.runGit(['rev-parse', 'HEAD']);

    assert.equal(
      (
        await cancelled.operate(id, {
          kind: 'checkout',
          refId,
          expectedSha: sha,
        })
      ).kind,
      'cancelled',
    );
    assert.equal(await f.runGit(['rev-parse', 'HEAD']), before);
    cancelled.dispose();
    const tracking = await createGitAdapter({
      updateDiverged: async () => null,
      remoteCheckout: async () => ({ kind: 'create', name: 'tracking-alpha' }),
    });

    temporaryAdapters.push(tracking);
    assert.equal(
      (
        await tracking.operate(id, {
          kind: 'checkout',
          refId,
          expectedSha: sha,
        })
      ).kind,
      'success',
    );
    assert.equal(
      (await f.runGit(['branch', '--show-current'])).trim(),
      'tracking-alpha',
    );
    assert.equal(
      (await f.runGit(['rev-parse', '--abbrev-ref', '@{upstream}'])).trim(),
      'alpha/main',
    );
    tracking.dispose();
    await f.runGit(['checkout', 'topic']);
    const existing = await createGitAdapter({
      updateDiverged: async () => null,
      remoteCheckout: async (_ref, locals) => {
        assert.ok(locals.some((ref) => ref.name === 'tracking-alpha'));
        const local = locals.find((ref) => ref.name === 'tracking-alpha')!;

        return { kind: 'existing', refId: local.id, expectedSha: local.sha };
      },
    });

    temporaryAdapters.push(existing);
    assert.equal(
      (
        await existing.operate(id, {
          kind: 'checkout',
          refId,
          expectedSha: sha,
        })
      ).kind,
      'success',
    );
    assert.equal(
      (await f.runGit(['branch', '--show-current'])).trim(),
      'tracking-alpha',
    );
    existing.dispose();
    await f.runGit(['checkout', 'topic']);
  });
  it('dirty tree error does not stash and branch in another worktree is not forced', async () => {
    const f = fixtures[0]!;

    await f.runGit(['checkout', '-b', 'topic']);

    await writeFile(join(f.root, 'sample.txt'), 'topic\n');
    await f.runGit(['add', '.']);
    await f.runGit(['commit', '-m', 'Topic change']);
    const topic = (await f.runGit(['rev-parse', 'HEAD'])).trim();

    await writeFile(join(f.root, 'sample.txt'), 'dirty\n');
    const stash = await f.runGit(['stash', 'list']);

    assert.equal(
      (
        await adapter.operate(id, {
          kind: 'checkout',
          refId: 'refs/heads/main',
          expectedSha: original,
        })
      ).kind,
      'error',
    );
    assert.equal(await f.runGit(['stash', 'list']), stash);
    assert.equal((await f.runGit(['rev-parse', 'HEAD'])).trim(), topic);
    await writeFile(join(f.root, 'sample.txt'), 'topic\n');
    await f.runGit(['worktree', 'add', f.root + '.linked', 'main']);
    assert.equal(
      (
        await adapter.operate(id, {
          kind: 'checkout',
          refId: 'refs/heads/main',
          expectedSha: original,
        })
      ).kind,
      'error',
    );
    assert.equal(
      (await f.runGit(['branch', '--show-current'])).trim(),
      'topic',
    );
    await f.runGit(['worktree', 'remove', f.root + '.linked']);
  });
  it('cherry pick targets chosen SHA and branch; conflict remains for native resolution', async () => {
    const f = fixtures[0]!;
    const other = fixtures[1]!;
    const otherHead = await other.runGit(['rev-parse', 'HEAD']);

    await f.runGit(['checkout', '-b', 'topic']);
    await writeFile(join(f.root, 'sample.txt'), 'topic\n');
    await f.runGit(['add', 'sample.txt']);
    await f.runGit(['commit', '-m', 'Target branch change']);
    await f.runGit(['checkout', 'main']);
    await writeFile(join(f.root, 'new.txt'), 'cherry\n');
    await f.runGit(['add', '.']);
    await f.runGit(['commit', '-m', 'Selected change']);
    const selected = (await f.runGit(['rev-parse', 'HEAD'])).trim();

    await f.runGit(['checkout', 'topic']);
    let head = (await f.runGit(['rev-parse', 'HEAD'])).trim();
    const success = await adapter.operate(id, {
      kind: 'cherry-pick',
      sha: selected,
      expectedHeadSha: head,
      expectedBranch: 'topic',
    });

    assert.equal(success.kind, 'success');
    assert.equal(success.backend, 'cli');
    assert.equal(await f.runGit(['show', 'HEAD:new.txt']), 'cherry\n');
    assert.equal(await other.runGit(['rev-parse', 'HEAD']), otherHead);
    await f.runGit(['checkout', 'main']);
    await writeFile(join(f.root, 'sample.txt'), 'conflicting\n');
    await f.runGit(['add', '.']);
    await f.runGit(['commit', '-m', 'Conflict source']);
    const conflict = (await f.runGit(['rev-parse', 'HEAD'])).trim();

    await f.runGit(['checkout', 'topic']);
    head = (await f.runGit(['rev-parse', 'HEAD'])).trim();
    const failed = await adapter.operate(id, {
      kind: 'cherry-pick',
      sha: conflict,
      expectedHeadSha: head,
      expectedBranch: 'topic',
    });

    assert.ok(failed.kind === 'conflict');
    assert.equal(failed.recovery, 'source-control');
    assert.equal(
      failed.message,
      'Git found conflicts. Resolve them in Source Control.',
    );
    assert.equal(
      (await f.runGit(['rev-parse', 'CHERRY_PICK_HEAD'])).trim(),
      conflict,
    );
    assert.ok(
      (await f.runGit(['diff', '--name-only', '--diff-filter=U'])).includes(
        'sample.txt',
      ),
    );
    await f.runGit(['cherry-pick', '--abort']);
    const stale = await adapter.operate(id, {
      kind: 'cherry-pick',
      sha: selected,
      expectedHeadSha: original,
      expectedBranch: 'topic',
    });

    assert.equal(stale.kind, 'error');
    const tree = (await f.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
    const merge = (
      await f.runGit([
        'commit-tree',
        tree,
        '-p',
        head,
        '-p',
        selected,
        '-m',
        'Merge',
      ])
    ).trim();

    assert.equal(
      (
        await adapter.operate(id, {
          kind: 'cherry-pick',
          sha: merge,
          expectedHeadSha: head,
          expectedBranch: 'topic',
        })
      ).kind,
      'error',
    );
    await f.runGit(['checkout', '--detach', head]);
    assert.equal(
      (
        await adapter.operate(id, {
          kind: 'cherry-pick',
          sha: selected,
          expectedHeadSha: head,
          expectedBranch: 'topic',
        })
      ).kind,
      'error',
    );
  });
});

describe('literal namespace-looking branch names', () => {
  it('keeps distinct reference identities through browse resolve and checkout at equal tips', async () => {
    const fixture = await createFixture({
      prefix: 'git-ui-native literal refs ',
    });
    let adapter: GitAdapter | undefined;

    try {
      adapter = await createGitAdapter();

      for (const name of ['topic', 'refs/heads/topic'])
        await fixture.runGit(['branch', name]);
      for (const name of ['v1', 'refs/tags/v1'])
        await fixture.runGit(['tag', name]);
      const head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const id = vscode.Uri.file(fixture.root).toString();

      await (
        await getGitApi()
      ).api.openRepository(vscode.Uri.file(fixture.root));
      const refs = await adapter.references(id);

      assert.equal(new Set(refs.map((ref) => ref.id)).size, refs.length);
      const literal = refs.find(
        (ref) => ref.id === 'refs/heads/refs/heads/topic',
      );

      assert.equal(literal?.name, 'refs/heads/topic');
      assert.equal(
        refs.find((ref) => ref.id === 'refs/tags/refs/tags/v1')?.name,
        'refs/tags/v1',
      );
      const page = await adapter.history(id, {
        scope: { kind: 'ref', refId: 'refs/heads/refs/heads/topic' },
        text: '',
        cursor: null,
      });

      assert.equal(page.commits[0]?.sha, head);
      const resolved = await adapter.resolve(id, 'refs/heads/refs/heads/topic');

      assert.equal(resolved.kind, 'commit');
      const collision = await adapter.resolve(id, 'refs/heads/topic');

      assert.equal(collision.kind, 'choices');
      if (collision.kind === 'choices')
        assert.deepEqual(collision.references.map((ref) => ref.name).sort(), [
          'refs/heads/topic',
          'topic',
        ]);
      const result = await adapter.operate(id, {
        kind: 'checkout',
        refId: 'refs/heads/refs/heads/topic',
        expectedSha: head,
      });

      assert.equal(result.kind, 'success');
      assert.equal(
        (await fixture.runGit(['symbolic-ref', 'HEAD'])).trim(),
        'refs/heads/refs/heads/topic',
      );
      await fixture.runGit(['checkout', 'topic']);
      await writeFile(
        join(fixture.root, 'sample.txt'),
        'different ordinary tip\n',
      );
      await fixture.runGit(['add', 'sample.txt']);
      await fixture.runGit(['commit', '-m', 'Different ordinary branch tip']);
      await fixture.runGit(['checkout', 'main']);
      const again = await adapter.operate(id, {
        kind: 'checkout',
        refId: 'refs/heads/refs/heads/topic',
        expectedSha: head,
      });

      assert.equal(again.kind, 'success');
      assert.equal(
        (await fixture.runGit(['symbolic-ref', 'HEAD'])).trim(),
        'refs/heads/refs/heads/topic',
      );
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
      assert.equal(
        (await fixture.runGit(['status', '--porcelain'])).trim(),
        '',
      );
    } finally {
      adapter?.dispose();
      await fixture.dispose();
    }
  });
});
