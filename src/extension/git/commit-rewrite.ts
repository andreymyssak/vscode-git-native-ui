import { realpath } from 'node:fs/promises';

import type { CommitRangeTarget } from '../../shared/model';
import type { GitApiAccess } from './api';
import type { GitCli } from './cli';
import type { CommitSuffixSnapshot } from './commit-suffix';
import { attachedBranch, readCommit } from './commit-suffix';
import {
  requireCleanWorkingTree,
  requireNoGitOperation,
} from './working-tree-state';

export interface CommitRewriteSnapshot extends CommitSuffixSnapshot {
  replayShas: readonly string[];
}

/** Prove every replayed node is linear, including unselected descendants. */
export async function validateRewriteRange(
  access: GitApiAccess,
  cli: Pick<GitCli, 'run'>,
  id: string,
  target: CommitRangeTarget,
  minimum: number,
): Promise<CommitRewriteSnapshot> {
  const shas = target.shas.map((sha) => sha.toLowerCase());
  const identity = /^(?:[a-f\d]{40}|[a-f\d]{64})$/;
  const selected = new Set(shas);

  if (shas.length < minimum || selected.size !== shas.length)
    throw new Error(`Select at least ${minimum} distinct commits.`);
  if (
    !shas.every((sha) => identity.test(sha)) ||
    !identity.test(target.expectedHeadSha)
  )
    throw new Error('Select full commit identities before editing history.');
  const root = await realpath(access.repository(id).rootUri.fsPath);

  await requireNoGitOperation(cli, id, 'editing history');
  const assertCurrent = async () => {
    if (
      (await attachedBranch(cli, id)) !== target.expectedBranch ||
      (await cli.run(id, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim() !==
        target.expectedHeadSha
    )
      throw new Error(
        'The current branch or HEAD changed. Select the commits again.',
      );
  };

  await assertCurrent();
  await requireCleanWorkingTree(
    cli,
    id,
    'Commit or stash working changes in Source Control before editing history.',
  );
  const objects = new Map<string, Awaited<ReturnType<typeof readCommit>>>();

  for (const sha of shas) objects.set(sha, await readCommit(cli, id, sha));
  // First-parent traversal is valid only while each replayed node has one parent.
  const rows = (
    await cli.run(id, [
      'rev-list',
      '--first-parent',
      '--parents',
      target.expectedHeadSha,
    ])
  )
    .trim()
    .split('\n');
  const newestToOldest: string[] = [];
  const remaining = new Set(selected);
  let oldestParentSha = '';

  for (const row of rows) {
    const [sha, ...parents] = row.split(' ');

    if (!sha || !identity.test(sha))
      throw new Error('Git returned an invalid history identity.');
    if (parents.length !== 1)
      throw new Error(
        parents.length
          ? 'The replayed history includes a merge commit. Select a linear range.'
          : 'Root commits cannot be rewritten in this range.',
      );
    newestToOldest.push(sha);
    remaining.delete(sha);
    if (!remaining.size) {
      oldestParentSha = parents[0]!;
      break;
    }
  }

  if (remaining.size || !oldestParentSha)
    throw new Error('Select commits from the current branch history.');
  const replayShas = newestToOldest.reverse();
  const oldestToNewest = replayShas.filter((sha) => selected.has(sha));

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
      'This range is in known remote history. Published commits cannot be rewritten here.',
    );
  const commits = oldestToNewest.map((sha) => objects.get(sha)!);
  const head = await readCommit(cli, id, target.expectedHeadSha);

  if ((await realpath(access.repository(id).rootUri.fsPath)) !== root)
    throw new Error('Repository root changed. Select the commits again.');
  await assertCurrent();

  return {
    ...target,
    shas,
    replayShas,
    oldestToNewest,
    oldestParentSha,
    treeSha: head.treeSha,
    messages: commits.map((commit) => commit.message),
  };
}
