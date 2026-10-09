import { lstat, realpath } from 'node:fs/promises';
import { normalize, resolve } from 'node:path';

import type { CommitRangeTarget } from '../../shared/model';
import { hasErrorCode } from '../../shared/validation';
import type { GitApiAccess } from './api';
import type { GitCli } from './cli';
import { GitRequiresSourceControl } from './working-tree-state';

export interface CommitSuffixSnapshot extends CommitRangeTarget {
  oldestToNewest: readonly string[];
  oldestParentSha: string;
  treeSha: string;
  messages: readonly string[];
}

export interface CommitObject {
  parents: readonly string[];
  treeSha: string;
  message: string;
}

type Cli = Pick<GitCli, 'run'>;

const fullObjectIdentity = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;
const operationStates = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'rebase-merge',
  'rebase-apply',
  'sequencer',
] as const;

export async function readCommit(
  cli: Cli,
  id: string,
  sha: string,
): Promise<CommitObject> {
  let object: string;

  try {
    if ((await cli.run(id, ['cat-file', '-t', sha])).trim() !== 'commit')
      throw new Error(`The selected object ${sha} is not a commit.`);

    object = await cli.run(id, ['cat-file', 'commit', sha]);
  } catch (error) {
    if (hasErrorCode(error, 128))
      throw new Error(`The selected commit ${sha} is not available locally.`, {
        cause: error,
      });

    throw error;
  }

  const separator = object.indexOf('\n\n');
  const headers = object.slice(0, separator).split('\n');
  const treeSha = headers.find((line) => line.startsWith('tree '))?.slice(5);
  const parents = headers
    .filter((line) => line.startsWith('parent '))
    .map((line) => line.slice(7));

  if (
    separator < 0 ||
    !treeSha ||
    !fullObjectIdentity.test(treeSha) ||
    parents.some((sha) => !fullObjectIdentity.test(sha))
  )
    throw new Error(`The selected commit ${sha} has invalid object metadata.`);

  return { parents, treeSha, message: object.slice(separator + 2) };
}

export async function attachedBranch(cli: Cli, id: string): Promise<string> {
  let reference: string;

  try {
    reference = (await cli.run(id, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
  } catch (error) {
    if (hasErrorCode(error, 1))
      throw new Error('Check out a branch before squashing commits.', {
        cause: error,
      });

    throw error;
  }

  if (!reference.startsWith('refs/heads/'))
    throw new Error('Check out a branch before squashing commits.');

  return reference.slice('refs/heads/'.length);
}

async function requireNoOperation(
  cli: Cli,
  id: string,
  root: string,
): Promise<void> {
  for (const state of operationStates) {
    const path = (
      await cli.run(id, [
        'rev-parse',
        '--path-format=absolute',
        '--git-path',
        state,
      ])
    ).replace(/\r?\n$/, '');

    try {
      await lstat(resolve(root, path));
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) continue;

      throw error;
    }

    throw new GitRequiresSourceControl(
      `Finish the current Git operation (${state}) before squashing commits.`,
    );
  }
}

export async function validateCommitSuffix(
  access: GitApiAccess,
  cli: Cli,
  id: string,
  target: CommitRangeTarget,
  purpose: 'squash' | 'drop',
): Promise<CommitSuffixSnapshot> {
  try {
    return await validateSuffix(access, cli, id, target, purpose);
  } catch (error) {
    if (purpose === 'squash' || !(error instanceof Error)) throw error;
    throw new Error(
      error.message
        .replaceAll('squashing', 'dropping')
        .replaceAll('Squashing', 'Dropping')
        .replaceAll('squashed', 'dropped')
        .replaceAll('squash', 'drop'),
      { cause: error },
    );
  }
}

async function validateSuffix(
  access: GitApiAccess,
  cli: Cli,
  id: string,
  target: CommitRangeTarget,
  purpose: 'squash' | 'drop',
): Promise<CommitSuffixSnapshot> {
  const shas = target.shas.map((sha) => sha.toLowerCase());
  const expectedBranch = target.expectedBranch;
  const expectedHeadSha = target.expectedHeadSha.toLowerCase();

  if (shas.length < (purpose === 'squash' ? 2 : 1))
    throw new Error(
      purpose === 'squash'
        ? 'Select at least two commits to squash.'
        : 'Select at least one commit to drop.',
    );

  if (
    !shas.every((sha) => fullObjectIdentity.test(sha)) ||
    !fullObjectIdentity.test(expectedHeadSha)
  )
    throw new Error('Select full commit identities before squashing.');

  const selected = new Set(shas);

  if (selected.size !== shas.length)
    throw new Error('Select distinct commits without duplicate identities.');

  const root = await realpath(access.repository(id).rootUri.fsPath);
  const canonical = (path: string) =>
    process.platform === 'win32'
      ? normalize(path).toLowerCase()
      : normalize(path);

  await requireNoOperation(cli, id, root);

  const branch = await attachedBranch(cli, id);
  const headSha = (
    await cli.run(id, ['rev-parse', '--verify', 'HEAD^{commit}'])
  ).trim();

  if (branch !== expectedBranch || headSha !== expectedHeadSha)
    throw new Error(
      'The current branch or HEAD changed. Select the current commits again.',
    );

  if (!selected.has(headSha))
    throw new Error('The selected suffix must end at the current branch HEAD.');

  if (
    (
      await cli.run(id, [
        '--no-optional-locks',
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ])
    ).length
  )
    throw new GitRequiresSourceControl(
      'Squashing requires a clean index and working tree, including untracked files and submodules.',
    );

  const commits = new Map<string, CommitObject>();

  for (const sha of shas) {
    const commit = await readCommit(cli, id, sha);

    if (!commit.parents.length)
      throw new Error('Root commits cannot be squashed in this version.');

    if (commit.parents.length !== 1)
      throw new Error('Select ordinary commits without merge parents.');

    commits.set(sha, commit);
  }

  const newestToOldest: string[] = [];
  let current = headSha;

  while (selected.has(current)) {
    newestToOldest.push(current);
    current = commits.get(current)!.parents[0]!;
  }

  if (newestToOldest.length !== selected.size)
    throw new Error(
      'Select a complete consecutive parent chain ending at HEAD.',
    );

  const oldestToNewest = newestToOldest.reverse();
  const oldestParentSha = current;
  const range = (
    await cli.run(id, [
      'rev-list',
      '--reverse',
      '--topo-order',
      `${oldestParentSha}..${headSha}`,
    ])
  )
    .trim()
    .split('\n')
    .filter(Boolean);

  if (
    range.length !== oldestToNewest.length ||
    range.some((sha, index) => sha !== oldestToNewest[index])
  )
    throw new Error(
      'The selected commits do not match the complete Git range.',
    );

  // Every selected commit descends from the oldest; any containing remote also contains it.
  if (
    (
      await cli.run(id, [
        'for-each-ref',
        `--contains=${oldestToNewest[0]!}`,
        '--format=%(refname)',
        'refs/remotes',
      ])
    ).trim()
  )
    throw new Error(
      'The selected range is contained in known remote history. Published commits cannot be squashed here.',
    );

  if (
    canonical(await realpath(access.repository(id).rootUri.fsPath)) !==
    canonical(root)
  )
    throw new Error('Repository root changed. Refresh before squashing.');

  if (
    (await attachedBranch(cli, id)) !== branch ||
    (await cli.run(id, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim() !==
      headSha
  )
    throw new Error(
      'The current branch or HEAD changed during squash validation.',
    );

  return {
    shas,
    expectedBranch,
    expectedHeadSha,
    oldestToNewest,
    oldestParentSha,
    treeSha: commits.get(headSha)!.treeSha,
    messages: oldestToNewest.map((sha) => commits.get(sha)!.message),
  };
}
