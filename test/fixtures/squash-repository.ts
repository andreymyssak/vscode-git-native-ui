import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type {
  GitAPI,
  GitApiAccess,
  GitRepository,
} from '../../src/extension/git/api';
import { GitCli } from '../../src/extension/git/cli';
import type { CommitRangeTarget } from '../../src/shared/model';
import { gitFixtureEnvironment } from './git-environment';

const execute = promisify(execFile);

export function squashAccess(root: string): GitApiAccess {
  const repository = {
    rootUri: { fsPath: root, toString: () => pathToFileURL(root).href },
  } as unknown as GitRepository;

  return {
    api: { git: { path: 'git' } } as GitAPI,
    repository: (id) => {
      assert.equal(id, 'fixture');

      return repository;
    },
    repositories: () => [],
  };
}

export async function createSquashFixture(
  objectFormat: 'sha1' | 'sha256' = 'sha1',
) {
  const directory = await mkdtemp(
    join(tmpdir(), 'git-ui-native squash preflight ü '),
  );

  try {
    const root = join(directory, 'repository');
    const globalConfig = join(directory, 'gitconfig');

    await mkdir(root);
    await writeFile(globalConfig, '');

    const env = gitFixtureEnvironment({
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'Squash Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Squash Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.test',
    });
    const runGit = async (args: readonly string[], cwd = root) =>
      (
        await execute('git', [...args], {
          cwd,
          env,
          maxBuffer: 32 * 1024 * 1024,
        })
      ).stdout;

    await runGit([
      'init',
      '--initial-branch=main',
      `--object-format=${objectFormat}`,
    ]);
    await runGit(['config', 'commit.gpgsign', 'false']);
    await runGit(['config', 'core.autocrlf', 'false']);
    await runGit(['config', 'user.name', 'Squash Fixture']);
    await runGit(['config', 'user.email', 'fixture@example.test']);

    const commit = async (contents: string, message: string) => {
      await writeFile(join(root, 'sample.txt'), contents);
      await runGit(['add', 'sample.txt']);
      await runGit(['commit', '-m', message]);

      return (await runGit(['rev-parse', 'HEAD'])).trim();
    };

    const initial = await commit('initial\n', 'Initial');
    const a = await commit('A\n', 'A subject\n\nFirst body');
    const b = await commit('B\n', 'B subject');
    const c = await commit('C\n', 'C ü subject\n\nLast body');

    await runGit(['branch', 'retained-branch', a]);
    await runGit(['tag', 'retained-tag', b]);

    const access = squashAccess(root);
    const target: CommitRangeTarget = {
      shas: [c, b, a],
      expectedBranch: 'main',
      expectedHeadSha: c,
    };
    const state = async (cwd = root) => {
      const files: Record<string, string> = {};
      const walk = async (path: string): Promise<void> => {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          if (entry.name === '.git') continue;

          const child = join(path, entry.name);

          if (entry.isDirectory()) await walk(child);
          else
            files[relative(cwd, child)] = (await readFile(child)).toString(
              'hex',
            );
        }
      };

      await walk(cwd);

      const index = (
        await runGit(
          ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
          cwd,
        )
      ).trim();

      return {
        head: (await runGit(['rev-parse', 'HEAD'], cwd)).trim(),
        refs: await runGit(['show-ref', '--head'], cwd),
        index: (await readFile(resolve(cwd, index))).toString('hex'),
        files,
      };
    };

    return {
      directory,
      root,
      runGit,
      access,
      cli: new GitCli(access),
      target,
      initial,
      a,
      b,
      c,
      state,
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export type SquashFixture = Awaited<ReturnType<typeof createSquashFixture>>;
