import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, assert, beforeAll, expect, test } from 'vitest';

import type { GitCli } from '../../src/extension/git/cli';
import { createOperations } from '../../src/extension/git/operations';
import { SquashRecovery } from '../../src/extension/git/squash-recovery';
import type { GitAction } from '../../src/shared/model';
import { buildHelperFixture } from '../fixtures/helper-build';
import type { SquashFixture } from '../fixtures/squash-repository';
import {
  createSquashFixture,
  squashAccess,
} from '../fixtures/squash-repository';

const execute = promisify(execFile);
let helperPath: string;
let built: Awaited<ReturnType<typeof buildHelperFixture<'helper'>>>;
const runtime = {
  executable: process.execPath,
  get helperPath() {
    return helperPath;
  },
};
const message =
  'Approved ü\n\n# keep this literal comment\nBody with trailing spaces   \n\n';

beforeAll(async () => {
  built = await buildHelperFixture({
    helper: 'src/extension/git/squash-helper.ts',
  });
  helperPath = built.paths.helper;
});
afterAll(async () => {
  await built?.dispose();
});

async function withFixture(work: (fixture: SquashFixture) => Promise<void>) {
  const fixture = await createSquashFixture();
  const previous = process.env.GIT_CONFIG_GLOBAL;
  const previousSystem = process.env.GIT_CONFIG_NOSYSTEM;

  process.env.GIT_CONFIG_GLOBAL = join(fixture.directory, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  fixture.access.repository('fixture').status = async () => {};

  try {
    await work(fixture);
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    if (previousSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = previousSystem;
    await fixture.dispose();
  }
}

function operation(
  fixture: SquashFixture,
  cli: Pick<GitCli, 'run'> = fixture.cli,
) {
  const recovery = new SquashRecovery(join(fixture.directory, 'recovery'), cli);
  const run = createOperations(
    fixture.access,
    cli,
    { updateDiverged: async () => null, remoteCheckout: async () => null },
    { runtime, recovery },
  );
  const action: Extract<
    GitAction,
    {
      kind: 'squash-commits';
    }
  > = {
    kind: 'squash-commits',
    target: fixture.target,
    message,
  };

  return { run, recovery, action };
}

const isRebase = (args: readonly string[]) =>
  args.includes('rebase') && args.includes('--interactive');

test('one queued squash preserves the final tree, base, approved message and unrelated refs', async () => {
  await withFixture(async (fixture) => {
    await fixture.runGit(['config', 'rebase.autoSquash', 'true']);
    await fixture.runGit(['config', 'rebase.updateRefs', 'true']);
    await fixture.runGit(['config', 'rebase.abbreviateCommands', 'true']);
    await fixture.runGit(['config', 'rebase.instructionFormat', '%h %s']);
    await fixture.runGit(['config', 'core.commentChar', ';']);
    await fixture.runGit(['config', 'pull.twohead', 'ours']);
    const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
    const branch = await fixture.runGit([
      'rev-parse',
      'refs/heads/retained-branch',
    ]);
    const tag = await fixture.runGit(['rev-parse', 'refs/tags/retained-tag']);
    let attempts = 0;
    const cli: Pick<GitCli, 'run'> = {
      run: async (...args) => {
        if (isRebase(args[1])) attempts++;

        return fixture.cli.run(...args);
      },
    };
    const { run, action } = operation(fixture, cli);
    const result = await run('fixture', action);

    assert.ok(result.kind === 'success', JSON.stringify(result));
    expect(attempts).toBe(1);
    const replacement = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

    expect(result.replacementSha).toBe(replacement);
    expect((await fixture.runGit(['rev-parse', 'HEAD^'])).trim()).toBe(
      fixture.initial,
    );
    expect((await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim()).toBe(
      tree,
    );
    expect(
      (
        await fixture.runGit([
          'rev-list',
          '--count',
          `${fixture.initial}..HEAD`,
        ])
      ).trim(),
    ).toBe('1');
    expect(
      await fixture.runGit(['rev-parse', 'refs/heads/retained-branch']),
    ).toBe(branch);
    expect(await fixture.runGit(['rev-parse', 'refs/tags/retained-tag'])).toBe(
      tag,
    );
    const object = await fixture.runGit(['cat-file', 'commit', 'HEAD']);

    expect(object.slice(object.indexOf('\n\n') + 2)).toBe(message);
    expect(await fixture.runGit(['status', '--porcelain=v1'])).toBe('');
    expect(await readdir(join(fixture.directory, 'recovery'))).toStrictEqual(
      [],
    );
    expect((await fixture.runGit(['config', 'rebase.updateRefs'])).trim()).toBe(
      'true',
    );
    expect((await fixture.runGit(['config', 'pull.twohead'])).trim()).toBe(
      'ours',
    );
  });
});
test('squash keeps the oldest author when selected commits have different authors', async () => {
  await withFixture(async (fixture) => {
    let parent = fixture.initial;
    const shas: string[] = [];

    for (const [index, old] of [fixture.a, fixture.b, fixture.c].entries()) {
      const tree = (
        await fixture.runGit(['rev-parse', `${old}^{tree}`])
      ).trim();
      const sha = (
        await execute(
          'git',
          ['commit-tree', tree, '-p', parent, '-m', `Authored ${index}`],
          {
            cwd: fixture.root,
            env: {
              ...process.env,
              GIT_AUTHOR_NAME: `Author ${index}`,
              GIT_AUTHOR_EMAIL: `author${index}@example.test`,
              GIT_AUTHOR_DATE: '2024-01-02T03:04:05+00:00',
            },
          },
        )
      ).stdout.trim();

      shas.push(sha);
      parent = sha;
    }

    await fixture.runGit(['update-ref', 'refs/heads/main', parent]);
    fixture.target.shas = [...shas].reverse();
    fixture.target.expectedHeadSha = parent;
    const author = await fixture.runGit([
      'show',
      '-s',
      '--format=%an%x00%ae%x00%aI',
      shas[0]!,
    ]);
    const { run, action } = operation(fixture);
    const result = await run('fixture', action);

    expect(result.kind, JSON.stringify(result)).toBe('success');
    expect(
      await fixture.runGit([
        'show',
        '-s',
        '--format=%an%x00%ae%x00%aI',
        'HEAD',
      ]),
    ).toBe(author);
  });
});
test('dirty, stale, remote-contained and invalid-message targets make zero rebase attempts', async () => {
  for (const rejection of ['dirty', 'stale', 'remote', 'message'] as const) {
    await withFixture(async (fixture) => {
      if (rejection === 'dirty')
        await writeFile(join(fixture.root, 'untracked.txt'), 'keep\n');
      if (rejection === 'stale') fixture.target.expectedHeadSha = fixture.b;
      if (rejection === 'remote')
        await fixture.runGit([
          'update-ref',
          'refs/remotes/origin/main',
          fixture.a,
        ]);
      const before = await fixture.state();
      let attempts = 0;
      const cli: Pick<GitCli, 'run'> = {
        run: async (...args) => {
          if (isRebase(args[1])) attempts++;

          return fixture.cli.run(...args);
        },
      };
      const { run, action } = operation(fixture, cli);

      if (rejection === 'message')
        Object.assign(action, { message: 'é'.repeat(524289) });
      const result = await run('fixture', action);

      expect(result.kind, `${rejection}: ${JSON.stringify(result)}`).toBe(
        'error',
      );
      expect(attempts, rejection).toBe(0);
      expect(await fixture.state(), rejection).toStrictEqual(before);
    });
  }
});
test('a squash cancelled while waiting for the repository queue creates no input or write', async () => {
  await withFixture(async (fixture) => {
    let release!: () => void;
    const wait = new Promise<void>((resolveWait) => {
      release = resolveWait;
    });

    fixture.access.repository('fixture').fetch = () => wait;
    const { run, action } = operation(fixture);
    const before = await fixture.state();
    const first = run('fixture', { kind: 'fetch-all' });
    const context = new AbortController();
    const squash = run('fixture', action, context.signal);

    context.abort();
    release();
    await first;
    expect((await squash).kind).toBe('cancelled');
    expect(await fixture.state()).toStrictEqual(before);
    await expect(
      stat(join(fixture.directory, 'recovery')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
test('cancelling during the final preflight leaves the repository untouched and removes unused inputs', async () => {
  await withFixture(async (fixture) => {
    const context = new AbortController();
    const storage = join(fixture.directory, 'recovery');
    const headPath = (
      await fixture.runGit([
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'HEAD',
      ])
    ).trim();
    const headBytes = await readFile(headPath);
    const before = await fixture.state();
    let inFinalPreflight = false;
    let headReads = 0;
    const cli: Pick<GitCli, 'run'> = {
      run: async (...args) => {
        if (isRebase(args[1])) {
          const beforeExecute = args[3];

          args[3] = async () => {
            inFinalPreflight = true;
            try {
              await beforeExecute?.();
            } finally {
              inFinalPreflight = false;
            }
          };
        }

        const output = await fixture.cli.run(...args);

        if (
          inFinalPreflight &&
          args[1].join(' ') === 'rev-parse --verify HEAD^{commit}' &&
          ++headReads === 2
        ) {
          // Cancel as the actual final HEAD read completes, before validation
          // returns to the execution guard. The read result stays unchanged.
          const inputs = await readdir(storage);

          expect(inputs.length).toBe(1);
          await stat(join(storage, inputs[0]!, 'input.json'));
          context.abort();
        }

        return output;
      },
    };
    const { run, action } = operation(fixture, cli);
    const result = await run('fixture', action, context.signal);

    expect(result.kind, JSON.stringify(result)).toBe('cancelled');
    expect(await fixture.state()).toStrictEqual(before);
    expect(await readFile(headPath)).toStrictEqual(headBytes);
    expect(await readdir(storage)).toStrictEqual([]);
    for (const state of ['rebase-merge', 'rebase-apply']) {
      const path = (
        await fixture.runGit([
          'rev-parse',
          '--path-format=absolute',
          '--git-path',
          state,
        ])
      ).trim();

      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
test('the final execution guard rejects a newly dirty tree and removes unused owned input', async () => {
  await withFixture(async (fixture) => {
    let rebaseStarted = false;
    const cli: Pick<GitCli, 'run'> = {
      run: async (...args) => {
        if (isRebase(args[1])) {
          await writeFile(join(fixture.root, 'late-untracked.txt'), 'keep\n');
          const guard = args[3];

          await guard?.();
          rebaseStarted = true;
        }

        return fixture.cli.run(...args);
      },
    };
    const { run, action } = operation(fixture, cli);
    const result = await run('fixture', action);

    expect(result.kind).toBe('error');
    expect(rebaseStarted).toBe(false);
    expect((await fixture.runGit(['rev-parse', 'HEAD'])).trim()).toBe(
      fixture.c,
    );
    expect(
      await readFile(join(fixture.root, 'late-untracked.txt'), 'utf8'),
    ).toBe('keep\n');
    expect(await readdir(join(fixture.directory, 'recovery'))).toStrictEqual(
      [],
    );
  });
});
test('a view change after Git starts does not abort the rebase', async () => {
  await withFixture(async (fixture) => {
    const context = new AbortController();
    let starts = 0;
    const cli: Pick<GitCli, 'run'> = {
      run: async (...args) => {
        if (isRebase(args[1])) {
          expect(args[2]).toBe(undefined);
          const beforeExecute = args[3];

          args[3] = async () => {
            await beforeExecute?.();
            starts++;
            context.abort();
          };
        }

        return fixture.cli.run(...args);
      },
    };
    const { run, action } = operation(fixture, cli);
    const result = await run('fixture', action, context.signal);

    expect(result.kind, JSON.stringify(result)).toBe('success');
    expect(starts).toBe(1);
    expect(
      (
        await fixture.runGit([
          'rev-list',
          '--count',
          `${fixture.initial}..HEAD`,
        ])
      ).trim(),
    ).toBe('1');
  });
});
test('a rejecting pre-rebase hook is attempted once and never falls back or rewrites refs', async () => {
  await withFixture(async (fixture) => {
    const hookDirectory = join(fixture.directory, 'hooks');
    const record = join(fixture.directory, 'hook-attempts');

    await mkdir(hookDirectory);
    const hook = join(hookDirectory, 'pre-rebase');

    await writeFile(
      hook,
      '#!/bin/sh\nprintf "attempt\\n" >> "$GIT_UI_TEST_HOOK_RECORD"\nexit 1\n',
    );
    await chmod(hook, 0o755);
    await fixture.runGit(['config', 'core.hooksPath', hookDirectory]);
    const previous = process.env.GIT_UI_TEST_HOOK_RECORD;

    process.env.GIT_UI_TEST_HOOK_RECORD = record;
    try {
      const before = await fixture.state();
      const { run, action } = operation(fixture);
      const result = await run('fixture', action);

      expect(result.kind, JSON.stringify(result)).toBe('error');
      expect(await readFile(record, 'utf8')).toBe('attempt\n');
      expect(await fixture.state()).toStrictEqual(before);
      expect(await readdir(join(fixture.directory, 'recovery'))).toStrictEqual(
        [],
      );
    } finally {
      if (previous === undefined) delete process.env.GIT_UI_TEST_HOOK_RECORD;
      else process.env.GIT_UI_TEST_HOOK_RECORD = previous;
    }
  });
});
test('stopped signing failure retains private editors across reopening until native abort', async () => {
  await withFixture(async (fixture) => {
    const signer = join(fixture.directory, 'reject-signing');

    await writeFile(
      signer,
      '#!/bin/sh\necho "Fixture signing rejected" >&2\nexit 1\n',
    );
    await chmod(signer, 0o755);
    await fixture.runGit(['config', 'gpg.program', signer]);
    await fixture.runGit(['config', 'commit.gpgsign', 'true']);
    let attempts = 0;
    const cli: Pick<GitCli, 'run'> = {
      run: async (...args) => {
        if (isRebase(args[1])) attempts++;

        return fixture.cli.run(...args);
      },
    };
    const { run, action } = operation(fixture, cli);
    const result = await run('fixture', action);

    expect(result.kind, JSON.stringify(result)).toBe('error');
    expect(attempts).toBe(1);
    const rebase = (
      await fixture.runGit([
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'rebase-merge',
      ])
    ).trim();

    await stat(rebase);
    const storage = join(fixture.directory, 'recovery');
    const [directory] = await readdir(storage);

    assert.ok(directory);
    const input = join(storage, directory, 'input.json');

    expect(JSON.parse(await readFile(input, 'utf8')).message).toBe(message);
    const reopened = new SquashRecovery(storage, fixture.cli);

    await reopened.reconcile();
    await stat(input);
    await fixture.runGit(['-c', 'commit.gpgsign=false', 'rebase', '--abort']);
    await reopened.reconcile();
    expect(await readdir(storage)).toStrictEqual([]);
    expect((await fixture.runGit(['rev-parse', 'HEAD'])).trim()).toBe(
      fixture.c,
    );
  });
});
test('the same backend squashes a linked worktree and retains empty and cancelling changes', async () => {
  await withFixture(async (fixture) => {
    const linked = join(fixture.directory, 'linked ü');

    await fixture.runGit([
      'worktree',
      'add',
      '-b',
      'linked',
      linked,
      fixture.initial,
    ]);
    const runGit = (args: readonly string[]) => fixture.runGit(args, linked);

    await runGit([
      'commit',
      '--allow-empty',
      '--author',
      'Zero Net Oldest <zero-old@example.test>',
      '-m',
      'Intentionally empty',
    ]);
    const first = (await runGit(['rev-parse', 'HEAD'])).trim();

    await writeFile(join(linked, 'sample.txt'), 'changed\n');
    await runGit(['add', 'sample.txt']);
    await runGit(['commit', '-m', 'Change']);
    const second = (await runGit(['rev-parse', 'HEAD'])).trim();

    await writeFile(join(linked, 'sample.txt'), 'initial\n');
    await runGit(['add', 'sample.txt']);
    await runGit(['commit', '-m', 'Cancel change']);
    const last = (await runGit(['rev-parse', 'HEAD'])).trim();
    const author = await runGit([
      'show',
      '-s',
      '--format=%an%x00%ae%x00%aI',
      first,
    ]);
    const branch = await fixture.runGit([
      'rev-parse',
      'refs/heads/retained-branch',
    ]);
    const tag = await fixture.runGit(['rev-parse', 'refs/tags/retained-tag']);
    const access = squashAccess(linked);

    access.repository('fixture').status = async () => {};

    const original = fixture.access.repository;

    fixture.access.repository = access.repository;
    fixture.target = {
      shas: [last, second, first],
      expectedBranch: 'linked',
      expectedHeadSha: last,
    };
    try {
      const { run, action } = operation(fixture);
      const result = await run('fixture', action);

      expect(result.kind, JSON.stringify(result)).toBe('success');
      expect((await runGit(['rev-parse', 'HEAD^'])).trim()).toBe(
        fixture.initial,
      );
      expect(
        await runGit(['show', '-s', '--format=%an%x00%ae%x00%aI', 'HEAD']),
      ).toBe(author);
      const object = await runGit(['cat-file', 'commit', 'HEAD']);

      expect(object.slice(object.indexOf('\n\n') + 2)).toBe(message);
      expect(
        await fixture.runGit(['rev-parse', 'refs/heads/retained-branch']),
      ).toBe(branch);
      expect(
        await fixture.runGit(['rev-parse', 'refs/tags/retained-tag']),
      ).toBe(tag);
      expect(await readdir(join(fixture.directory, 'recovery'))).toStrictEqual(
        [],
      );
      expect(
        (
          await runGit(['rev-list', '--count', `${fixture.initial}..HEAD`])
        ).trim(),
      ).toBe('1');
      expect((await runGit(['rev-parse', 'HEAD^{tree}'])).trim()).toBe(
        (
          await fixture.runGit(['rev-parse', `${fixture.initial}^{tree}`])
        ).trim(),
      );
      expect((await fixture.runGit(['rev-parse', 'main'])).trim()).toBe(
        fixture.c,
      );
    } finally {
      fixture.access.repository = original;
    }
  });
});
test('an intermediate cancelling squash stop retains native recovery without retry until explicit abort', async () => {
  await withFixture(async (fixture) => {
    await fixture.runGit(['checkout', '-b', 'intermediate', fixture.initial]);
    const shas: string[] = [];

    for (const [contents, subject] of [
      ['Changed\n', 'Change'],
      ['initial\n', 'Cancel'],
      ['Finished\n', 'Finish'],
    ]) {
      await writeFile(join(fixture.root, 'sample.txt'), contents!);
      await fixture.runGit(['add', 'sample.txt']);
      await fixture.runGit(['commit', '-m', subject!]);
      shas.push((await fixture.runGit(['rev-parse', 'HEAD'])).trim());
    }

    const originalHead = shas.at(-1)!;
    const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
    const refs = await fixture.runGit(['show-ref']);
    const calls: string[][] = [];
    const cli: Pick<GitCli, 'run'> = {
      run: (...args) => {
        calls.push([...args[1]]);

        return fixture.cli.run(...args);
      },
    };

    fixture.target = {
      shas: [...shas].reverse(),
      expectedBranch: 'intermediate',
      expectedHeadSha: originalHead,
    };
    const { run, action } = operation(fixture, cli);
    const result = await run('fixture', action);

    expect(result.kind, JSON.stringify(result)).toBe('error');
    if (result.kind === 'error')
      expect(result.message).toMatch(/make\s+it empty/);
    expect(calls.filter((args) => isRebase(args)).length).toBe(1);
    expect(
      calls
        .map((args) => {
          let index = 0;

          while (args[index] === '-c') index += 2;

          return args[index]!;
        })
        .filter((command) =>
          ['rebase', 'reset', 'checkout', 'commit', 'cherry-pick'].includes(
            command,
          ),
        ),
    ).toStrictEqual(['rebase']);
    expect(await fixture.runGit(['show-ref'])).toBe(refs);
    const state = (
      await fixture.runGit([
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'rebase-merge',
      ])
    ).trim();

    await stat(state);
    expect(await readFile(join(state, 'done'), 'utf8')).toMatch(
      /fixup .* Cancel/,
    );
    const storage = join(fixture.directory, 'recovery');
    const [directory] = await readdir(storage);

    assert.ok(directory);
    const input = join(storage, directory, 'input.json');

    expect(JSON.parse(await readFile(input, 'utf8')).message).toBe(message);
    const reopened = new SquashRecovery(storage, fixture.cli);

    await reopened.reconcile();
    await stat(input);
    await stat(state);
    await fixture.runGit(['rebase', '--abort']);
    await reopened.reconcile();
    expect(await readdir(storage)).toStrictEqual([]);
    expect((await fixture.runGit(['rev-parse', 'HEAD'])).trim()).toBe(
      originalHead,
    );
    expect((await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim()).toBe(
      tree,
    );
    expect(await fixture.runGit(['show-ref'])).toBe(refs);
    expect(await fixture.runGit(['status', '--porcelain=v1'])).toBe('');
  });
});
