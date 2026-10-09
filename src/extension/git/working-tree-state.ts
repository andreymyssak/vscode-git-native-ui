import { lstat } from 'node:fs/promises';

import { hasErrorCode } from '../../shared/validation';
import type { GitCli } from './cli';

export class GitRequiresSourceControl extends Error {}

type Cli = Pick<GitCli, 'run'>;

export async function requireCleanWorkingTree(
  cli: Cli,
  id: string,
  message: string,
): Promise<void> {
  if (
    (
      await cli.run(id, [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--ignore-submodules=none',
        '-z',
      ])
    ).length
  )
    throw new GitRequiresSourceControl(message);
}

export async function requireNoGitOperation(
  cli: Cli,
  id: string,
  verb: string,
): Promise<void> {
  for (const [state, operation] of [
    ['MERGE_HEAD', 'merge'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['sequencer', 'sequence'],
  ]) {
    const path = (
      await cli.run(id, [
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        state!,
      ])
    ).replace(/\r?\n$/, '');

    try {
      await lstat(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) continue;
      throw error;
    }

    throw new GitRequiresSourceControl(
      `Finish the current Git operation (${operation}) in Source Control before ${verb}.`,
    );
  }
}
