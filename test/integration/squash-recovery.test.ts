import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

import { afterAll, assert, beforeAll, expect, test } from 'vitest';

import { createOperations } from '../../src/extension/git/operations';
import { validateSquash } from '../../src/extension/git/squash';
import { SquashRecovery } from '../../src/extension/git/squash-recovery';
import type { OperationResult } from '../../src/shared/model';
import { buildHelperFixture } from '../fixtures/helper-build';
import { createSquashFixture } from '../fixtures/squash-repository';

const execute = promisify(execFile);
let helperPath: string;
let reconcilerPath: string;
let built: Awaited<
  ReturnType<typeof buildHelperFixture<'helper' | 'reconcile'>>
>;

beforeAll(async () => {
  built = await buildHelperFixture({
    helper: 'src/extension/git/squash-helper.ts',
    reconcile: 'test/fixtures/squash-recovery-process.ts',
  });
  helperPath = built.paths.helper;
  reconcilerPath = built.paths.reconcile;
});
afterAll(async () => {
  await built?.dispose();
});

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    try {
      await stat(path);

      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    await setTimeout(25);
  }

  throw new Error('The fixture pre-rebase hook did not reach its gate.');
}

test('another process cannot remove active squash editors while a pre-rebase hook blocks', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  const previous = {
    global: process.env.GIT_CONFIG_GLOBAL,
    system: process.env.GIT_CONFIG_NOSYSTEM,
    ready: process.env.GIT_NATIVE_UI_RECOVERY_READY,
    release: process.env.GIT_NATIVE_UI_RECOVERY_RELEASE,
  };
  const ready = join(fixture.directory, 'hook-ready');
  const release = join(fixture.directory, 'hook-release');
  let running: Promise<OperationResult> | undefined;

  process.env.GIT_CONFIG_GLOBAL = join(fixture.directory, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_NATIVE_UI_RECOVERY_READY = ready;
  process.env.GIT_NATIVE_UI_RECOVERY_RELEASE = release;
  fixture.access.repository('fixture').status = async () => {};

  try {
    const hooks = join(fixture.directory, 'hooks');

    await mkdir(hooks);
    const hook = join(hooks, 'pre-rebase');

    await writeFile(
      hook,
      '#!/bin/sh\nprintf "ready\\n" > "$GIT_NATIVE_UI_RECOVERY_READY"\nwhile test ! -f "$GIT_NATIVE_UI_RECOVERY_RELEASE"; do sleep 0.05; done\n',
    );
    await chmod(hook, 0o755);
    await fixture.runGit(['config', 'core.hooksPath', hooks]);
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const operate = createOperations(
      fixture.access,
      fixture.cli,
      { updateDiverged: async () => null, remoteCheckout: async () => null },
      { runtime: { executable: process.execPath, helperPath }, recovery },
    );
    const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();

    running = operate('fixture', {
      kind: 'squash-commits',
      target: fixture.target,
      message: 'Reviewed across windows\n',
    });
    await waitForFile(ready);
    const rebase = (
      await fixture.runGit([
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'rebase-merge',
      ])
    ).trim();

    await expect(stat(rebase)).rejects.toMatchObject({ code: 'ENOENT' });
    const [directory] = await readdir(storage);

    assert.ok(directory);
    const input = join(storage, directory, 'input.json');

    await execute(process.execPath, [reconcilerPath, fixture.root, storage]);
    expect(JSON.parse(await readFile(input, 'utf8')).message).toBe(
      'Reviewed across windows\n',
    );
    await writeFile(release, 'release\n');
    const result = await running;

    expect(result.kind, JSON.stringify(result)).toBe('success');
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
    expect(await readdir(storage)).toStrictEqual([]);
  } finally {
    try {
      await writeFile(release, 'release\n');
      await running;
    } finally {
      for (const [key, value] of [
        ['GIT_CONFIG_GLOBAL', previous.global],
        ['GIT_CONFIG_NOSYSTEM', previous.system],
        ['GIT_NATIVE_UI_RECOVERY_READY', previous.ready],
        ['GIT_NATIVE_UI_RECOVERY_RELEASE', previous.release],
      ]) {
        if (value === undefined) delete process.env[key!];
        else process.env[key!] = value;
      }

      await fixture.dispose();
    }
  }
});
test('fresh recovery retains an unobserved orphan rather than assuming absent state proves completion', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const owned = await recovery.create(
      'fixture',
      snapshot,
      'Crash boundary draft',
    );
    const reopened = new SquashRecovery(storage, fixture.cli);

    await reopened.reconcile();
    await stat(owned.inputPath);
    await reopened.settle('fixture', owned.directory);
    await stat(owned.inputPath);
    await recovery.settle('fixture', owned.directory);
    await expect(stat(owned.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await fixture.dispose();
  }
});
for (const kind of ['file', 'symlink'] as const)
  test(`a ${kind} at a rebase state path cannot establish terminal cleanup proof`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    try {
      const storage = join(fixture.directory, 'storage');
      const recovery = new SquashRecovery(storage, fixture.cli);
      const snapshot = await validateSquash(
        fixture.access,
        fixture.cli,
        'fixture',
        fixture.target,
      );
      const owned = await recovery.create('fixture', snapshot, 'Unknown state');
      const state = (
        await fixture.runGit([
          'rev-parse',
          '--path-format=absolute',
          '--git-path',
          'rebase-merge',
        ])
      ).trim();

      if (kind === 'file') await writeFile(state, 'not Git sequencer state');
      else await symlink(fixture.directory, state, 'junction');
      await new SquashRecovery(storage, fixture.cli).reconcile();
      await stat(owned.inputPath);
      await rm(state);
      await new SquashRecovery(storage, fixture.cli).reconcile();
      await stat(owned.inputPath);
    } finally {
      await fixture.dispose();
    }
  });
test('recovery retains pending input, records observed state across processes and cleans after native continue', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const owned = await recovery.create('fixture', snapshot, 'Reviewed draft');

    await execute(process.execPath, [reconcilerPath, fixture.root, storage]);
    await stat(owned.inputPath);
    const resumed = join(fixture.directory, 'native-resume');
    const command = `test -f '${resumed.replaceAll("'", "'\"'\"'")}'`;

    await expect(
      fixture.runGit([
        'rebase',
        '--force-rebase',
        '--exec',
        command,
        fixture.initial,
      ]),
    ).rejects.toThrow();
    await execute(process.execPath, [reconcilerPath, fixture.root, storage]);
    await stat(owned.inputPath);
    const originalTree = (
      await fixture.runGit(['rev-parse', 'main^{tree}'])
    ).trim();

    await writeFile(resumed, 'resume\n');
    await fixture.runGit(['rebase', '--continue']);
    expect((await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim()).toBe(
      originalTree,
    );
    await execute(process.execPath, [reconcilerPath, fixture.root, storage]);
    await expect(stat(owned.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await fixture.dispose();
  }
});
test('recovery inputs are private, literal, outside the repository and cleaned after terminal Git state', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const message = 'Squashed ü\n\n$(touch unrelated) "literal"';
    const owned = await recovery.create('fixture', snapshot, message);
    const child = relative(await realpath(storage), owned.directory);

    assert.ok(child && !isAbsolute(child) && !child.startsWith('..'));
    const input = JSON.parse(await readFile(owned.inputPath, 'utf8'));

    expect(input).toStrictEqual({
      operation: 'squash',
      replayShas: snapshot.replayShas,
      messageCommitSha: input.messageCommitSha,
      oldestToNewest: snapshot.oldestToNewest,
      message,
    });
    expect(
      (
        await fixture.runGit(['rev-parse', `${input.messageCommitSha}^`])
      ).trim(),
    ).toBe(snapshot.oldestParentSha);
    expect(
      (
        await fixture.runGit(['rev-parse', `${input.messageCommitSha}^{tree}`])
      ).trim(),
    ).toBe(
      (
        await fixture.runGit([
          'rev-parse',
          `${snapshot.oldestParentSha}^{tree}`,
        ])
      ).trim(),
    );
    expect(
      (
        await fixture.runGit([
          'show',
          '-s',
          '--format=%B',
          input.messageCommitSha,
        ])
      ).trimEnd(),
    ).toBe(message);
    if (process.platform !== 'win32') {
      expect((await stat(owned.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(owned.inputPath)).mode & 0o777).toBe(0o600);
    }

    const other = join(storage, 'unrecorded');

    await mkdir(other);
    await writeFile(join(other, 'keep.txt'), 'unrelated');
    await recovery.settle('fixture', owned.directory);
    await expect(stat(owned.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(other, 'keep.txt'), 'utf8')).toBe('unrelated');
  } finally {
    await fixture.dispose();
  }
});
test('repository-change reconciliation cannot remove an input before its queued rebase starts', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const owned = await recovery.create('fixture', snapshot, 'Reviewed');

    await recovery.reconcile();
    expect(
      (
        JSON.parse(await readFile(owned.inputPath, 'utf8')) as {
          message: string;
        }
      ).message,
    ).toBe('Reviewed');
    await recovery.settle('fixture', owned.directory);
    await expect(stat(owned.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await fixture.dispose();
  }
});
test('an active rebase retains the message across reopen; native abort then permits cleanup', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const owned = await recovery.create(
      'fixture',
      snapshot,
      'Reviewed message',
    );

    await expect(
      fixture.runGit([
        'rebase',
        '--force-rebase',
        '--exec',
        'false',
        fixture.initial,
      ]),
    ).rejects.toThrow();
    const rebase = (
      await fixture.runGit([
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        'rebase-merge',
      ])
    ).trim();

    assert.ok((await stat(rebase)).isDirectory());
    await recovery.settle('fixture', owned.directory);
    expect(
      (
        JSON.parse(await readFile(owned.inputPath, 'utf8')) as {
          message: string;
        }
      ).message,
    ).toBe('Reviewed message');
    const reopened = new SquashRecovery(storage, fixture.cli);

    await reopened.reconcile();
    await stat(owned.directory);
    await fixture.runGit(['rebase', '--abort']);
    await reopened.reconcile();
    await expect(stat(owned.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    await fixture.dispose();
  }
});
test('unavailable repositories and corrupt or escaping records cannot trigger deletion', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const owned = await recovery.create('fixture', snapshot, 'Reviewed');
    const inaccessible = new SquashRecovery(storage, {
      run: async () => {
        throw new Error('repository closed');
      },
    });

    await inaccessible.reconcile();
    await stat(owned.directory);
    const recordPath = join(owned.directory, 'record.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<
      string,
      unknown
    >;

    await writeFile(
      recordPath,
      JSON.stringify({ ...record, directory: fixture.root }),
    );
    await recovery.settle('fixture', owned.directory);
    await stat(fixture.root);
    await stat(owned.directory);
    await writeFile(recordPath, '{broken');
    await recovery.settle('fixture', owned.directory);
    await stat(owned.directory);
  } finally {
    await fixture.dispose();
  }
});
test('recovery refuses a foreign directory and retains inputs after repository identity changes', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const owned = await recovery.create('fixture', snapshot, 'Reviewed');

    await expect(recovery.settle('fixture', fixture.root)).rejects.toThrow(
      /owned|directory/i,
    );
    await expect(
      fixture.runGit([
        'rebase',
        '--force-rebase',
        '--exec',
        'false',
        fixture.initial,
      ]),
    ).rejects.toThrow();
    await recovery.settle('fixture', owned.directory);
    await fixture.runGit(['rebase', '--abort']);
    const changed = new SquashRecovery(storage, {
      run: async (_id, args) =>
        args.includes('--show-toplevel')
          ? fixture.directory + '\n'
          : fixture.cli.run('fixture', args),
    });

    await changed.reconcile();
    await stat(owned.directory);
  } finally {
    await fixture.dispose();
  }
});
test('symlinked ownership metadata and operation directories never mutate a foreign target', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const storage = join(fixture.directory, 'storage');
    const recovery = new SquashRecovery(storage, fixture.cli);
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const owned = await recovery.create('fixture', snapshot, 'Reviewed');
    const recordPath = join(owned.directory, 'record.json');
    const foreign = join(fixture.directory, 'foreign');

    await mkdir(foreign);
    const foreignRecord = join(foreign, 'record.json');
    const text = await readFile(recordPath, 'utf8');

    await writeFile(foreignRecord, text);
    await rm(recordPath);
    await symlink(foreignRecord, recordPath);
    await recovery.settle('fixture', owned.directory);
    await stat(owned.inputPath);
    assert.ok((await lstat(recordPath)).isSymbolicLink());
    expect(await readFile(foreignRecord, 'utf8')).toBe(text);
    const linked = join(storage, 'operation-foreign-link');

    await symlink(foreign, linked, 'junction');
    await new SquashRecovery(storage, fixture.cli).reconcile();
    assert.ok((await lstat(linked)).isSymbolicLink());
    expect(await readFile(foreignRecord, 'utf8')).toBe(text);
  } finally {
    await fixture.dispose();
  }
});
