import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { assert, expect, test } from 'vitest';

import { createFixture } from '../fixtures/repository';

const execute = promisify(execFile);

test('tangled demo includes real two- and three-parent differences, an empty parent, and incoming-only branches', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'git-native-ui graph-demo '));

  try {
    const { stdout } = await execute(
      process.execPath,
      [resolve('scripts/dev/create-demo.ts')],
      { cwd: directory },
    );
    const output = JSON.parse(stdout) as {
      root: string;
      updateExamples: {
        incoming: number;
        outgoing: number;
      }[];
    };
    const git = async (...args: string[]) =>
      (await execute('git', args, { cwd: output.root })).stdout.trim();
    const revision = async (message: string) =>
      git('log', '--all', '--format=%H', `--grep=^${message}$`);
    const files = async (sha: string, index: number) =>
      (await git('diff', '--name-only', `${sha}^${index}`, sha, '--'))
        .split('\n')
        .filter(Boolean);
    const merge = await revision('UI incorporates API 4');

    expect(await files(merge, 1)).toStrictEqual([
      'packages/api/src/cycle-4.ts',
    ]);
    expect(await files(merge, 2)).toStrictEqual([
      'packages/ui/src/cycle-4.tsx',
    ]);
    const octopus = await revision('Three-parent release integration 4');

    expect(await files(octopus, 1)).toStrictEqual([
      'docs/cycle-4.md',
      'integration/cycle-4.txt',
      'packages/api/src/cycle-4.ts',
      'packages/ui/src/cycle-4.tsx',
    ]);
    expect(await files(octopus, 2)).toStrictEqual(['docs/cycle-4.md']);
    expect(await files(octopus, 3)).toStrictEqual([
      'integration/cycle-4.txt',
      'packages/api/src/cycle-4.ts',
      'packages/ui/src/cycle-4.tsx',
    ]);
    const empty = await git('rev-parse', 'examples/empty-second-parent');

    expect(await files(empty, 1)).toStrictEqual(['examples/feature.txt']);
    expect(await files(empty, 2)).toStrictEqual([]);
    expect(
      output.updateExamples.map(({ incoming, outgoing }) => [
        incoming,
        outgoing,
      ]),
    ).toStrictEqual([
      [1, 0],
      [5, 0],
      [7, 0],
      [0, 0],
    ]);
    for (const [branch, incoming] of [
      ['maintenance/behind-one', 1],
      ['maintenance/behind-five', 5],
      ['maintenance/behind-merge', 7],
      ['maintenance/up-to-date', 0],
    ] as const)
      expect(
        await git(
          'rev-list',
          '--left-right',
          '--count',
          `${branch}...${branch}@{upstream}`,
        ),
      ).toBe(`0\t${incoming}`);
    assert.ok(
      Number(
        await git(
          'rev-list',
          '--count',
          '--min-parents=2',
          'maintenance/behind-merge..maintenance/behind-merge@{upstream}',
        ),
      ) > 0,
    );
    expect(await git('status', '--porcelain')).toBe('');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('the demo generator ignores inherited Git routing and leaves another repository untouched', async () => {
  const other = await createFixture({
    prefix: 'git-native-ui-demo-isolation-',
  });
  const before = (await other.runGit(['rev-parse', 'HEAD'])).trim();
  let directory: string | null = null;

  try {
    const created = await execute(
      process.execPath,
      ['scripts/dev/create-demo.ts'],
      {
        env: {
          ...process.env,
          GIT_DIR: join(other.root, '.git'),
          GIT_WORK_TREE: other.root,
          GIT_INDEX_FILE: join(other.root, '.git/index'),
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'alias.status',
          GIT_CONFIG_VALUE_0: '!false',
        },
      },
    );
    const demo = JSON.parse(created.stdout) as {
      root: string;
      commits: number;
      mergeCommits: number;
    };

    directory = dirname(demo.root);
    expect(demo.root).not.toBe(other.root);
    expect((await other.runGit(['rev-parse', 'HEAD'])).trim()).toBe(before);
    expect((await other.runGit(['status', '--porcelain'])).trim()).toBe('');
    expect(demo.commits).toBe(153);
    expect(demo.mergeCommits).toBe(25);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    await other.dispose();
  }
});
