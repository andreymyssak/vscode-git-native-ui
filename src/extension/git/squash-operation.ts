import type { CommitRangeTarget } from '../../shared/model';
import type { GitApiAccess } from './api';
import type { GitCli } from './cli';
import { validateSquash, validateSquashMessage, verifySquash } from './squash';
import type { SquashRuntime } from './squash-editor';
import { createSquashEditors, probeSquashRuntime } from './squash-editor';
import type { SquashRecovery } from './squash-recovery';

export interface SquashServices {
  runtime: SquashRuntime;
  recovery: SquashRecovery;
}

/** Called only inside the repository mutation queue; a started rebase belongs to Git. */
export async function runSquash(
  access: GitApiAccess,
  cli: Pick<GitCli, 'run'>,
  id: string,
  target: CommitRangeTarget,
  message: string,
  services: SquashServices | undefined,
  context?: AbortSignal,
): Promise<string> {
  if (!services)
    throw new Error(
      'Squashing is unavailable because its private helper runtime is not configured.',
    );

  validateSquashMessage(message);
  context?.throwIfAborted();
  await probeSquashRuntime(services.runtime);
  const snapshot = await validateSquash(access, cli, id, target);
  const baseTree = (
    await cli.run(id, [
      'rev-parse',
      '--verify',
      `${snapshot.oldestParentSha}^{tree}`,
    ])
  ).trim();
  // Git 2.47 rejects an empty amended squash after cancelling patches. A known
  // zero-net group can replay as empty commits while preserving its final tree.
  // Select the ordinary strategy explicitly: Git can otherwise inherit a
  // configured pull.twohead strategy that discards the selected changes.
  const strategy =
    baseTree === snapshot.treeSha &&
    snapshot.replayShas.length === snapshot.shas.length
      ? '--strategy=ours'
      : '--strategy=ort';

  context?.throwIfAborted();
  const { directory, inputPath } = await services.recovery.create(
    id,
    snapshot,
    message,
  );

  try {
    const editors = createSquashEditors(services.runtime, inputPath);

    await cli.run(
      id,
      [
        '-c',
        'rebase.instructionFormat=%s',
        '-c',
        'rebase.abbreviateCommands=false',
        '-c',
        `core.abbrev=${snapshot.expectedHeadSha.length}`,
        '-c',
        'core.commentChar=#',
        '-c',
        'commit.cleanup=verbatim',
        'rebase',
        '--interactive',
        '--force-rebase',
        '--no-autostash',
        '--no-autosquash',
        '--no-fork-point',
        '--no-rebase-merges',
        '--no-update-refs',
        '--keep-empty',
        '--empty=keep',
        '--reapply-cherry-picks',
        strategy,
        snapshot.oldestParentSha,
      ],
      undefined,
      async () => {
        context?.throwIfAborted();
        validateSquashMessage(message);
        await probeSquashRuntime(services.runtime);
        await validateSquash(access, cli, id, snapshot);
        context?.throwIfAborted();
      },
      editors,
    );

    return await verifySquash(cli, id, snapshot);
  } finally {
    await services.recovery.settle(id, directory);
  }
}
