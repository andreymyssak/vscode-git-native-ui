import { rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assert, expect, test } from 'vitest';

import { createOperations } from '../../src/extension/git/operations';
import { readWorktrees } from '../../src/extension/git/worktrees';
import { createSquashFixture } from '../fixtures/squash-repository';

async function fixture() {
  const f = await createSquashFixture();
  const repo = f.access.repository('fixture');

  Object.defineProperty(repo, 'state', { value: { worktrees: [] } });
  repo.status = async () => {};

  const run = createOperations(f.access, f.cli, {
    updateDiverged: async () => null,
    remoteCheckout: async () => null,
  });

  return { ...f, run };
}

test('deleting a clean worktree preserves its branch, current checkout and dirty local work', async () => {
  const f = await fixture();
  const linked = join(f.root, '../linked');

  try {
    await f.runGit(['worktree', 'add', '-b', 'topic', linked]);
    await writeFile(join(f.root, 'local.txt'), 'Keep me');
    const worktrees = await readWorktrees(f.access, f.cli, 'fixture');
    const target = worktrees.find((w) => w.branch === 'topic')!;

    expect(target.main).toBe(false);
    expect(
      (
        await f.run('fixture', {
          kind: 'delete-worktrees',
          worktrees: [target],
        })
      ).kind,
    ).toBe('success');
    await expect(stat(linked)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await f.runGit(['rev-parse', 'topic'])).trim()).toBe(f.c);
    expect((await f.runGit(['branch', '--show-current'])).trim()).toBe('main');
    assert.ok(
      (await f.runGit(['status', '--porcelain'])).includes('local.txt'),
    );
  } finally {
    await rm(linked, { recursive: true, force: true });
    await f.dispose();
  }
});
test('batch deletion leaves dirty and locked worktrees intact, rejects forged groups, and reports partial completion', async () => {
  const f = await fixture();
  const one = join(f.root, '../one');
  const two = join(f.root, '../two');

  try {
    await f.runGit(['worktree', 'add', '-b', 'one', one]);
    await f.runGit(['worktree', 'add', '-b', 'two', two]);
    await writeFile(join(two, 'local.txt'), 'Keep');
    const items = await readWorktrees(f.access, f.cli, 'fixture');
    const alpha = items.find((w) => w.branch === 'one')!;
    const beta = items.find((w) => w.branch === 'two')!;

    expect(
      (
        await f.run('fixture', {
          kind: 'delete-worktrees',
          worktrees: [alpha, items[0]!],
        })
      ).kind,
    ).toBe('error');
    assert.ok(await stat(one));
    expect(
      (
        await f.run('fixture', {
          kind: 'delete-worktrees',
          worktrees: [{ ...alpha, rootUri: beta.rootUri }],
        })
      ).kind,
    ).toBe('error');
    const result = await f.run('fixture', {
      kind: 'delete-worktrees',
      worktrees: [alpha, beta],
    });

    assert.ok(result.kind === 'error');
    expect(result.message!).toMatch(/Deleted 1 worktree/);
    assert.ok(await stat(two));
    await f.runGit(['worktree', 'lock', two]);
    expect(
      (await f.run('fixture', { kind: 'delete-worktrees', worktrees: [beta] }))
        .kind,
    ).toBe('error');
    assert.ok(await stat(two));
  } finally {
    await rm(one, { recursive: true, force: true });
    await rm(two, { recursive: true, force: true });
    await f.dispose();
  }
});
test('a status failure after deletion still reports the actual removed folder', async () => {
  const f = await fixture();
  const linked = join(f.root, '../linked');

  try {
    await f.runGit(['worktree', 'add', '-b', 'topic', linked]);
    const target = (await readWorktrees(f.access, f.cli, 'fixture')).find(
      (w) => w.branch === 'topic',
    )!;

    f.access.repository('fixture').status = async () => {
      throw new Error('Refresh unavailable');
    };

    const result = await f.run('fixture', {
      kind: 'delete-worktrees',
      worktrees: [target],
    });

    assert.ok(result.kind === 'error');
    expect(result.message!).toMatch(/Deleted 1 worktree/);
    await expect(stat(linked)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(linked, { recursive: true, force: true });
    await f.dispose();
  }
});
test('a clean enclosing worktree cannot remove a nested registered checkout', async () => {
  const f = await fixture();
  const outer = join(f.root, '../outer');
  const nested = join(outer, 'nested');

  try {
    await f.runGit(['worktree', 'add', '-b', 'outer', outer]);
    await writeFile(join(outer, '.gitignore'), 'nested/\n');
    await f.runGit(['add', '.gitignore'], outer);
    await f.runGit(['commit', '-m', 'Ignore nested checkout'], outer);
    await f.runGit(['worktree', 'add', '-b', 'nested', nested]);
    await writeFile(join(nested, 'local.txt'), 'Keep nested work');
    expect((await f.runGit(['status', '--porcelain'], outer)).trim()).toBe('');
    const target = (await readWorktrees(f.access, f.cli, 'fixture')).find(
      (w) => w.branch === 'outer',
    )!;
    const result = await f.run('fixture', {
      kind: 'delete-worktrees',
      worktrees: [target],
    });

    assert.ok(result.kind === 'error');
    assert.ok(await stat(nested));
  } finally {
    await rm(outer, { recursive: true, force: true });
    await f.dispose();
  }
});
test('fresh open-folder protection prevents removal even after the worktree was listed', async () => {
  const f = await fixture();
  const linked = join(f.root, '../linked');

  try {
    await f.runGit(['worktree', 'add', '-b', 'topic', linked]);
    const target = (await readWorktrees(f.access, f.cli, 'fixture')).find(
      (w) => w.branch === 'topic',
    )!;

    f.access.worktreeProtectionPaths = () => [join(linked, 'sample.txt')];
    const result = await f.run('fixture', {
      kind: 'delete-worktrees',
      worktrees: [target],
    });

    assert.ok(result.kind === 'error');
    expect(result.message!).toMatch(/open in this window/);
    assert.ok(await stat(linked));
  } finally {
    await rm(linked, { recursive: true, force: true });
    await f.dispose();
  }
});
test('cancelling between removals retains the actual partial deletion and remaining checkout', async () => {
  const f = await fixture();
  const one = join(f.root, '../one');
  const two = join(f.root, '../two');

  try {
    await f.runGit(['worktree', 'add', '-b', 'one', one]);
    await f.runGit(['worktree', 'add', '-b', 'two', two]);
    const targets = (await readWorktrees(f.access, f.cli, 'fixture')).filter(
      (w) => !w.main,
    );
    const abort = new AbortController();
    const run = f.cli.run.bind(f.cli);

    f.cli.run = async (...args) => {
      const output = await run(...args);

      if (args[1][0] === 'worktree' && args[1][1] === 'remove') abort.abort();

      return output;
    };

    const result = await f.run(
      'fixture',
      { kind: 'delete-worktrees', worktrees: targets },
      abort.signal,
    );

    assert.ok(result.kind === 'error');
    expect(result.message!).toMatch(/Deleted 1 worktree.*Remaining worktrees/);
    await expect(stat(one)).rejects.toMatchObject({ code: 'ENOENT' });
    assert.ok(await stat(two));
  } finally {
    await rm(one, { recursive: true, force: true });
    await rm(two, { recursive: true, force: true });
    await f.dispose();
  }
});
test('an unrelated current merge conflict cannot replace the worktree deletion error', async () => {
  const f = await fixture();
  const linked = join(f.root, '../linked');

  try {
    await f.runGit(['worktree', 'add', '-b', 'topic', linked]);
    const target = (await readWorktrees(f.access, f.cli, 'fixture')).find(
      (w) => w.branch === 'topic',
    )!;

    await f.runGit(['switch', '-c', 'source', f.a]);
    await writeFile(join(f.root, 'sample.txt'), 'Conflicting source\n');
    await f.runGit(['commit', '-am', 'Source']);
    await f.runGit(['switch', 'main']);
    await expect(f.runGit(['merge', '--no-edit', 'source'])).rejects.toThrow();
    await f.runGit(['worktree', 'lock', linked]);
    const result = await f.run('fixture', {
      kind: 'delete-worktrees',
      worktrees: [target],
    });

    assert.ok(result.kind === 'error');
    expect(result.message!).toMatch(/locked/);
    assert.ok(await stat(linked));
    expect(
      (await f.runGit(['diff', '--name-only', '--diff-filter=U'])).trim(),
    ).toBe('sample.txt');
  } finally {
    await rm(linked, { recursive: true, force: true });
    await f.dispose();
  }
});
