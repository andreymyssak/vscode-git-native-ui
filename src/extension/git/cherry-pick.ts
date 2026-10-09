import type { CommitRangeTarget } from '../../shared/model';
import type { GitApiAccess } from './api';
import type { GitCli } from './cli';
import { actualParents } from './parents';
import {
  GitRequiresSourceControl,
  requireCleanWorkingTree,
  requireNoGitOperation,
} from './working-tree-state';

export async function cherryPickCommits(
  access: GitApiAccess,
  cli: Pick<GitCli, 'run'>,
  id: string,
  target: CommitRangeTarget,
  context?: AbortSignal,
): Promise<void> {
  const fullIdentity = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;

  if (
    !target.shas.length ||
    !target.shas.every((sha) => fullIdentity.test(sha)) ||
    new Set(target.shas.map((sha) => sha.toLowerCase())).size !==
      target.shas.length ||
    !fullIdentity.test(target.expectedHeadSha)
  )
    throw new Error('Select distinct full commit identities.');
  if (target.shas.length > 400)
    throw new Error('Cherry-pick up to 400 commits at a time.');
  for (const sha of target.shas) {
    const commit = await access.repository(id).getCommit(sha);

    if (
      commit.hash !== sha ||
      (await actualParents(commit, cli, id)).length > 1
    )
      throw new Error(
        'Merge cherry-picking requires a mainline choice and is unavailable.',
      );
  }

  const preflight = async () => {
    context?.throwIfAborted();
    await requireNoGitOperation(cli, id, 'cherry-picking');
    await requireCleanWorkingTree(
      cli,
      id,
      'Commit or stash local changes in Source Control before cherry-picking.',
    );
    const branch = (
      await cli.run(id, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    ).trim();
    const head = (await access.repository(id).getCommit('HEAD')).hash;

    if (branch !== target.expectedBranch || head !== target.expectedHeadSha)
      throw new Error(
        'The target branch or HEAD changed. Select the commits again.',
      );
    context?.throwIfAborted();
    access.repository(id);
  };

  await preflight();
  try {
    // Git owns partial progress. VS Code exposes Abort, but no sequence Continue/Skip command.
    await cli.run(id, ['cherry-pick', ...target.shas], undefined, preflight);
  } catch (error) {
    if (context?.aborted && error === context.reason) throw error;
    throw new GitRequiresSourceControl(
      'Cherry-pick stopped. Resolve changes in Source Control. Continue or skip with Git in the terminal, or use Git: Abort Cherry-Pick.',
      { cause: error },
    );
  }
}
