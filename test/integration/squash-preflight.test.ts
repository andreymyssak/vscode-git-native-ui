import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, expect, test } from 'vitest';

import type { GitApiAccess } from '../../src/extension/git/api';
import { GitCli } from '../../src/extension/git/cli';
import { validateSquash } from '../../src/extension/git/squash';
import type { CommitRangeTarget } from '../../src/shared/model';
import type { SquashFixture } from '../fixtures/squash-repository';
import {
  createSquashFixture,
  squashAccess,
} from '../fixtures/squash-repository';

async function rejectedWithoutMutation(
  fixture: SquashFixture,
  target: CommitRangeTarget,
  reason: RegExp,
  cli: Pick<GitCli, 'run'> = fixture.cli,
  access: GitApiAccess = fixture.access,
) {
  const before = await fixture.state();

  await expect(validateSquash(access, cli, 'fixture', target)).rejects.toThrow(
    reason,
  );
  expect(await fixture.state()).toStrictEqual(before);
}

test('preflight orders the complete suffix independently of input order', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const before = await fixture.state();
    const target = {
      ...fixture.target,
      shas: [fixture.b, fixture.c, fixture.a],
    };
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      target,
    );

    expect(snapshot.oldestToNewest).toStrictEqual([
      fixture.a,
      fixture.b,
      fixture.c,
    ]);
    expect(snapshot.oldestParentSha).toBe(fixture.initial);
    expect(snapshot.treeSha).toBe(
      (await fixture.runGit(['rev-parse', `${fixture.c}^{tree}`])).trim(),
    );
    expect(snapshot.messages).toStrictEqual([
      'A subject\n\nFirst body\n',
      'B subject\n',
      'C ü subject\n\nLast body\n',
    ]);
    expect(await fixture.state()).toStrictEqual(before);
    expect(snapshot.shas).not.toBe(target.shas);
  } finally {
    await fixture.dispose();
  }
});

test('a two-commit suffix is allowed when only its base is in known remote history', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    await fixture.runGit(['update-ref', 'refs/remotes/origin/main', fixture.a]);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      { ...fixture.target, shas: [fixture.c, fixture.b] },
    );

    expect(snapshot.oldestToNewest).toStrictEqual([fixture.b, fixture.c]);
    expect(snapshot.oldestParentSha).toBe(fixture.a);
  } finally {
    await fixture.dispose();
  }
});

for (const [label, change, reason] of [
  ['one member', (f: SquashFixture) => [f.c], /two|least|range/i],
  [
    'duplicate identities',
    (f: SquashFixture) => [f.c, f.b, f.b],
    /distinct|duplicate/i,
  ],
  [
    'case-variant duplicates',
    (f: SquashFixture) => [f.c, f.b, f.b.toUpperCase()],
    /distinct|duplicate/i,
  ],
  [
    'abbreviated identity',
    (f: SquashFixture) => [f.c, f.b.slice(0, 8)],
    /full|identity/i,
  ],
  [
    'option-shaped identity',
    (f: SquashFixture) => [f.c, '--all'],
    /full|identity/i,
  ],
  [
    'unavailable object',
    (f: SquashFixture) => [f.c, 'f'.repeat(40)],
    /commit|available|object/i,
  ],
  [
    'selected root commit',
    (f: SquashFixture) => [f.c, f.b, f.a, f.initial],
    /root|parent/i,
  ],
] as const) {
  test(`preflight refuses ${label} without changing refs, files or index`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    try {
      await rejectedWithoutMutation(
        fixture,
        { ...fixture.target, shas: change(fixture) },
        reason,
      );
    } finally {
      await fixture.dispose();
    }
  });
}

test('tree and annotated tag object identities cannot masquerade as commits', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();

    await fixture.runGit(['tag', '-a', 'annotated', '-m', 'Annotated']);
    const tag = (
      await fixture.runGit(['rev-parse', 'refs/tags/annotated'])
    ).trim();

    for (const object of [tree, tag]) {
      await rejectedWithoutMutation(
        fixture,
        { ...fixture.target, shas: [fixture.c, object] },
        /commit|object/i,
      );
    }
  } finally {
    await fixture.dispose();
  }
});

for (const condition of [
  'detached',
  'stale branch',
  'stale HEAD',
  'malformed expected HEAD',
] as const) {
  test(`preflight refuses ${condition} from authoritative Git state`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    try {
      if (condition === 'detached')
        await fixture.runGit(['checkout', '--detach', fixture.c]);
      const target = {
        ...fixture.target,
        ...(condition === 'stale branch' ? { expectedBranch: 'other' } : {}),
        ...(condition === 'stale HEAD' ? { expectedHeadSha: fixture.b } : {}),
        ...(condition === 'malformed expected HEAD'
          ? { expectedHeadSha: 'HEAD' }
          : {}),
      };

      await rejectedWithoutMutation(
        fixture,
        target,
        /branch|HEAD|identity|full|latest/i,
      );
    } finally {
      await fixture.dispose();
    }
  });
}

for (const condition of ['working tree', 'index', 'untracked'] as const) {
  test(`preflight refuses dirty ${condition} despite display settings`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    try {
      await fixture.runGit(['config', 'status.showUntrackedFiles', 'no']);
      await writeFile(
        join(
          fixture.root,
          condition === 'untracked' ? 'untracked.txt' : 'sample.txt',
        ),
        'dirty\n',
      );
      if (condition === 'index') await fixture.runGit(['add', 'sample.txt']);
      await rejectedWithoutMutation(
        fixture,
        fixture.target,
        /clean|changes|working|index/i,
      );
    } finally {
      await fixture.dispose();
    }
  });
}

for (const condition of [
  'working tree',
  'index',
  'untracked',
  'HEAD',
] as const) {
  test(`preflight refuses dirty submodule ${condition} even when repository settings hide it`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    const source = await createSquashFixture();

    t.onTestFinished(() => source.dispose());
    try {
      await fixture.runGit([
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        source.root,
        'nested',
      ]);
      await fixture.runGit(['commit', '-m', 'Add nested repository']);
      const head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const nested = join(fixture.root, 'nested');

      await fixture.runGit(['config', 'submodule.nested.ignore', 'all']);
      await fixture.runGit(['config', 'diff.ignoreSubmodules', 'all']);
      if (condition === 'HEAD')
        await fixture.runGit(
          ['commit', '--allow-empty', '-m', 'Nested change'],
          nested,
        );
      else
        await writeFile(
          join(
            nested,
            condition === 'untracked' ? 'untracked.txt' : 'sample.txt',
          ),
          'nested dirty\n',
        );
      if (condition === 'index')
        await fixture.runGit(['add', 'sample.txt'], nested);
      const nestedBefore = await fixture.state(nested);

      await rejectedWithoutMutation(
        fixture,
        { ...fixture.target, shas: [head, fixture.c], expectedHeadSha: head },
        /clean|submodule|working|index/i,
      );
      expect(await fixture.state(nested)).toStrictEqual(nestedBefore);
    } finally {
      await fixture.dispose();
      await source.dispose();
    }
  });
}

test('a canonical repository alias does not spuriously invalidate preflight', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const alias = join(fixture.directory, 'canonical alias');

    await symlink(fixture.root, alias, 'junction');
    const access = squashAccess(alias);
    const before = await fixture.state();
    const snapshot = await validateSquash(
      access,
      new GitCli(access),
      'fixture',
      fixture.target,
    );

    expect(snapshot.oldestToNewest).toStrictEqual([
      fixture.a,
      fixture.b,
      fixture.c,
    ]);
    expect(await fixture.state()).toStrictEqual(before);
  } finally {
    await fixture.dispose();
  }
});

for (const change of ['root', 'branch', 'HEAD'] as const) {
  test(`a ${change} change during preflight invalidates the captured snapshot`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    const other = change === 'root' ? await createSquashFixture() : null;

    try {
      let currentRoot = fixture.root;
      let stateAfterConcurrentChange:
        Awaited<ReturnType<SquashFixture['state']>> | undefined;
      const access: GitApiAccess = {
        ...fixture.access,
        repository: (id) => squashAccess(currentRoot).repository(id),
      };
      const cli: Pick<GitCli, 'run'> = {
        run: async (id, args) => {
          const result = await fixture.cli.run(id, args);

          if (args[0] === 'for-each-ref') {
            if (change === 'root') currentRoot = other!.root;
            else if (change === 'branch')
              await fixture.runGit(['checkout', '-b', 'moved']);
            else
              await fixture.runGit([
                'commit',
                '--allow-empty',
                '-m',
                'Concurrent commit',
              ]);
            stateAfterConcurrentChange = await fixture.state();
          }

          return result;
        },
      };

      await expect(
        validateSquash(access, cli, 'fixture', fixture.target),
      ).rejects.toThrow(/root.*changed|branch.*changed|HEAD.*changed/i);
      assert.ok(stateAfterConcurrentChange);
      expect(await fixture.state()).toStrictEqual(stateAfterConcurrentChange);
    } finally {
      await fixture.dispose();
      await other?.dispose();
    }
  });
}

test('shallow ancestry refuses rather than accepting an incomplete selected suffix', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const shallow = join(fixture.directory, 'shallow checkout');

    await fixture.runGit([
      'clone',
      '--depth=2',
      pathToFileURL(fixture.root).href,
      shallow,
    ]);
    const access = squashAccess(shallow);
    const before = await fixture.state(shallow);

    await expect(
      validateSquash(access, new GitCli(access), 'fixture', {
        ...fixture.target,
        shas: [fixture.c, fixture.b],
      }),
    ).rejects.toThrow(/unknown|revision|object|available|range|commit/i);
    expect(await fixture.state(shallow)).toStrictEqual(before);
  } finally {
    await fixture.dispose();
  }
});

test('a known remote containing any selected member refuses the whole range', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    await fixture.runGit([
      'update-ref',
      'refs/remotes/origin/older',
      fixture.a,
    ]);
    await rejectedWithoutMutation(fixture, fixture.target, /remote|published/i);
  } finally {
    await fixture.dispose();
  }
});

test('merge members and mixed-branch displayed ranges refuse without mutation', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    await fixture.runGit(['checkout', '-b', 'side', fixture.b]);
    await writeFile(join(fixture.root, 'side.txt'), 'side\n');
    await fixture.runGit(['add', 'side.txt']);
    await fixture.runGit(['commit', '-m', 'Side']);
    const side = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

    await fixture.runGit(['checkout', 'main']);
    await rejectedWithoutMutation(
      fixture,
      { ...fixture.target, shas: [fixture.c, fixture.b, side] },
      /consecutive|complete|chain|range/i,
    );
    await fixture.runGit(['merge', '--no-ff', '--no-edit', 'side']);
    const merge = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

    await rejectedWithoutMutation(
      fixture,
      { ...fixture.target, expectedHeadSha: merge, shas: [merge, fixture.c] },
      /merge|parent|ordinary/i,
    );
  } finally {
    await fixture.dispose();
  }
});

for (const state of [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'rebase-merge',
  'rebase-apply',
  'sequencer',
] as const) {
  test(`preflight refuses Git-resolved ${state} operation state`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    try {
      const path = resolve(
        fixture.root,
        (
          await fixture.runGit([
            'rev-parse',
            '--path-format=absolute',
            '--git-path',
            state,
          ])
        ).trim(),
      );
      const isDirectory = [
        'rebase-merge',
        'rebase-apply',
        'sequencer',
      ].includes(state);

      if (isDirectory) await mkdir(path);
      else await writeFile(path, fixture.a + '\n');
      await rejectedWithoutMutation(
        fixture,
        fixture.target,
        /operation|merge|rebase|cherry|revert|bisect|apply|sequencer/i,
      );
      if (!isDirectory)
        expect(await readFile(path, 'utf8')).toBe(fixture.a + '\n');
    } finally {
      await fixture.dispose();
    }
  });
}

for (const operation of [
  'merge',
  'cherry-pick',
  'revert',
  'rebase',
  'am',
  'bisect',
] as const) {
  test(`preflight refuses an actual interrupted Git ${operation}`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    try {
      if (operation === 'merge') {
        await fixture.runGit(['checkout', '-b', 'conflict', fixture.initial]);
        await writeFile(join(fixture.root, 'sample.txt'), 'conflicting side\n');
        await fixture.runGit(['commit', '-am', 'Conflicting side']);
        await fixture.runGit(['checkout', 'main']);
        await expect(fixture.runGit(['merge', 'conflict'])).rejects.toThrow();
      } else if (operation === 'bisect') {
        await fixture.runGit(['bisect', 'start', fixture.c, fixture.initial]);
      } else if (operation === 'am') {
        const patch = join(fixture.directory, 'change.patch');

        await writeFile(
          patch,
          await fixture.runGit(['format-patch', '--stdout', '-1', fixture.a]),
        );
        await expect(fixture.runGit(['am', patch])).rejects.toThrow();
      } else if (operation === 'rebase') {
        await expect(
          fixture.runGit(['rebase', '--onto', fixture.initial, fixture.b]),
        ).rejects.toThrow();
      } else {
        await expect(
          fixture.runGit([operation, '--no-edit', fixture.a]),
        ).rejects.toThrow();
      }

      await rejectedWithoutMutation(
        fixture,
        fixture.target,
        /operation|merge|rebase|cherry|revert|bisect|apply/i,
      );
    } finally {
      await fixture.dispose();
    }
  });
}

test('linked worktrees use their own operation paths rather than the common Git directory', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const linked = join(fixture.directory, 'linked worktree ü');

    await fixture.runGit([
      'worktree',
      'add',
      '-b',
      'linked',
      linked,
      fixture.c,
    ]);
    const access = squashAccess(linked);
    const cli = new GitCli(access);
    const target = { ...fixture.target, expectedBranch: 'linked' };
    const mainMerge = (
      await fixture.runGit([
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'MERGE_HEAD',
      ])
    ).trim();

    await writeFile(mainMerge, fixture.a + '\n');
    const snapshot = await validateSquash(access, cli, 'fixture', target);

    expect(snapshot.oldestToNewest).toStrictEqual([
      fixture.a,
      fixture.b,
      fixture.c,
    ]);
    const linkedCherry = (
      await fixture.runGit(
        [
          'rev-parse',
          '--path-format=absolute',
          '--git-path',
          'CHERRY_PICK_HEAD',
        ],
        linked,
      )
    ).trim();
    const before = await fixture.state(linked);

    expect(linkedCherry).not.toBe(
      join(fixture.root, '.git', 'CHERRY_PICK_HEAD'),
    );
    await writeFile(linkedCherry, fixture.b + '\n');
    await expect(
      validateSquash(access, cli, 'fixture', target),
    ).rejects.toThrow(/operation|cherry/i);
    expect(await fixture.state(linked)).toStrictEqual(before);
    expect(await readFile(mainMerge, 'utf8')).toBe(fixture.a + '\n');
    expect(await readFile(linkedCherry, 'utf8')).toBe(fixture.b + '\n');
  } finally {
    await fixture.dispose();
  }
});

test('unsupported Git refuses without attempting a mutation', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    await rejectedWithoutMutation(
      fixture,
      fixture.target,
      /Git.*2\.47|unsupported|version/i,
      {
        run: async (id, args) =>
          args[0] === '--version'
            ? 'git version 2.46.9\n'
            : fixture.cli.run(id, args),
      },
    );
  } finally {
    await fixture.dispose();
  }
});

test('preflight supports full SHA-256 identities and intentionally empty commits', async (t) => {
  const fixture = await createSquashFixture('sha256');

  t.onTestFinished(() => fixture.dispose());
  try {
    expect(fixture.c.length).toBe(64);
    await fixture.runGit(['commit', '--allow-empty', '-m', 'Empty one']);
    const first = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

    await fixture.runGit(['commit', '--allow-empty', '-m', 'Empty two']);
    const second = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      {
        shas: [second, first],
        expectedBranch: 'main',
        expectedHeadSha: second,
      },
    );

    expect(snapshot.oldestToNewest).toStrictEqual([first, second]);
    expect(snapshot.oldestParentSha).toBe(fixture.c);
    expect(snapshot.treeSha).toBe(
      (await fixture.runGit(['rev-parse', `${fixture.c}^{tree}`])).trim(),
    );
  } finally {
    await fixture.dispose();
  }
});
