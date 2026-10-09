import { readFile } from 'node:fs/promises';

import type { GitAction } from '../../shared/model';
import { hasErrorCode } from '../../shared/validation';
import type { GitCli } from './cli';
import { sameRoot } from './paths';
import {
  requireCleanWorkingTree,
  requireNoGitOperation,
} from './working-tree-state';

export type BranchUpdate = Extract<GitAction, { kind: 'update-branch' }>;
export interface UpdateCheckout {
  ref: string | null;
  sha: string;
}

type Cli = Pick<GitCli, 'run'>;

export async function updateCheckout(
  cli: Cli,
  id: string,
): Promise<UpdateCheckout> {
  let ref: string | null;

  try {
    ref = (await cli.run(id, ['symbolic-ref', '--quiet', 'HEAD'])).trim();
  } catch (error) {
    if (!hasErrorCode(error, 1)) throw error;
    ref = null;
  }

  const sha = (
    await cli.run(id, ['rev-parse', '--verify', 'HEAD^{commit}'])
  ).trim();

  if (
    (ref && !ref.startsWith('refs/heads/')) ||
    !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha)
  )
    throw new Error(
      'The current checkout could not be verified. Refresh before updating.',
    );

  return { ref, sha };
}

export async function validateUpdateTarget(
  cli: Cli,
  id: string,
  root: string,
  action: BranchUpdate,
  checkout: UpdateCheckout,
  expectedTip = action.expectedSha,
  signal?: AbortSignal,
  requireClean = true,
): Promise<{ remote: string; remoteRef: string }> {
  signal?.throwIfAborted();
  if (!action.refId.startsWith('refs/heads/'))
    throw new Error('Update requires a local branch.');
  const current = await updateCheckout(cli, id);

  if (current.ref !== checkout.ref || current.sha !== checkout.sha)
    throw new Error(
      'The checked-out branch or HEAD changed. Refresh before updating.',
    );
  const output = await cli.run(id, [
    'for-each-ref',
    '--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(symref)',
    action.refId,
  ]);
  const row = output
    .split('\n')
    .map((line) => line.split('\0'))
    .find((fields) => fields[0] === action.refId);
  const [, sha, upstream, remote, remoteRef, symbolic] = row ?? [];

  if (symbolic)
    throw new Error(
      'Update requires a direct local branch, not a symbolic reference.',
    );

  if (
    sha !== expectedTip ||
    upstream !== action.expectedUpstream ||
    !remote ||
    !remoteRef
  )
    throw new Error(
      'The branch tip or tracked upstream changed. Refresh before updating.',
    );
  if (requireClean)
    await requireCleanWorkingTree(
      cli,
      id,
      checkout.ref === action.refId
        ? 'Commit or stash local changes before updating.'
        : `Commit or stash local changes before checking out "${action.refId.slice('refs/heads/'.length)}".`,
    );
  await requireNoGitOperation(cli, id, 'updating');

  const worktrees = await cli.run(id, [
    'worktree',
    'list',
    '--porcelain',
    '-z',
  ]);

  for (const record of worktrees.split('\0\0')) {
    const fields = record.split('\0');
    const path = fields
      .find((field) => field.startsWith('worktree '))
      ?.slice(9);

    if (!path || sameRoot(path, root)) continue;
    if (fields.includes(`branch ${action.refId}`))
      throw new Error(
        'The selected branch is in another worktree. Update it from that worktree.',
      );
    // A rebase detaches HEAD, so porcelain no longer names its occupied branch.
    if (!fields.includes('detached')) continue;
    for (const state of [
      'rebase-merge/head-name',
      'rebase-apply/head-name',
      'BISECT_START',
    ]) {
      const headName = (
        await cli.run(id, [
          '-C',
          path,
          'rev-parse',
          '--path-format=absolute',
          '--git-path',
          state,
        ])
      ).replace(/\r?\n$/, '');

      try {
        const owner = (await readFile(headName, 'utf8')).trim();

        if (
          state === 'BISECT_START' &&
          (owner === action.refId ||
            owner === action.refId.slice('refs/heads/'.length))
        )
          throw new Error(
            'The selected branch is being bisected in another worktree. Finish that operation first.',
          );
        if (owner === action.refId)
          throw new Error(
            'The selected branch is being rebased in another worktree. Finish that operation first.',
          );
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      }
    }
  }

  const final = await updateCheckout(cli, id);

  if (final.ref !== checkout.ref || final.sha !== checkout.sha)
    throw new Error(
      'The checked-out branch or HEAD changed during validation.',
    );
  signal?.throwIfAborted();

  return { remote, remoteRef };
}
