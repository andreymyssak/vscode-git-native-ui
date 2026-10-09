import { isBranchDeletionSelection } from '../../shared/branch-selection';
import type {
  BranchDeletionTarget,
  OperationResult,
  Reference,
} from '../../shared/model';
import type { GitApiAccess } from './api';
import type { BranchRestores, DeletedBranch } from './branch-restore';
import type { GitCli } from './cli';
import { readReferences } from './resolve';

export async function deleteBranch(
  access: GitApiAccess,
  cli: Pick<GitCli, 'run'>,
  restores: BranchRestores,
  id: string,
  target: BranchDeletionTarget,
  context?: AbortSignal,
): Promise<{ record: DeletedBranch; backend: 'api' | 'cli' }> {
  const reference = async (): Promise<Reference> => {
    const ref = (await readReferences(access, id)).find(
      (ref) => ref.id === target.refId,
    );

    if (!ref || ref.sha !== target.expectedSha)
      throw new Error(
        'The selected reference changed. Refresh and select it again.',
      );
    if (ref.kind !== 'local')
      throw new Error('Delete requires a local branch.');

    return ref;
  };

  const ref = await reference();
  const record = await restores.capture(id, ref);

  await reference();
  context?.throwIfAborted();
  if (ref.name.startsWith('-'))
    await cli.run(id, ['branch', '-d', '--', ref.name]);
  else await access.repository(id).deleteBranch(ref.name, false);

  return { record, backend: ref.name.startsWith('-') ? 'cli' : 'api' };
}

export async function deleteBranches(
  access: GitApiAccess,
  cli: Pick<GitCli, 'run'>,
  restores: BranchRestores,
  id: string,
  targets: readonly BranchDeletionTarget[],
  context?: AbortSignal,
): Promise<OperationResult> {
  if (!isBranchDeletionSelection(targets.map((target) => target.refId)))
    throw new Error('Select between 2 and 400 distinct local branches.');
  const repo = access.repository(id);

  await repo.status();
  const refs = await readReferences(access, id);

  for (const target of targets) {
    const ref = refs.find((ref) => ref.id === target.refId);

    if (!ref || ref.kind !== 'local' || ref.sha !== target.expectedSha)
      throw new Error(
        'A selected branch changed. Refresh and select the branches again.',
      );
    if (ref.name === repo.state.HEAD?.name)
      throw new Error(
        'The current branch cannot be deleted. Select other local branches.',
      );
  }

  const deleted: DeletedBranch[] = [];
  const failures: string[] = [];
  const backends = new Set<'api' | 'cli'>();

  for (const target of targets) {
    if (context?.aborted) {
      failures.push(
        'The remaining branches were not deleted because the action was cancelled.',
      );
      break;
    }

    try {
      const result = await deleteBranch(
        access,
        cli,
        restores,
        id,
        target,
        context,
      );

      deleted.push(result.record);
      backends.add(result.backend);
    } catch (error) {
      failures.push(
        `"${target.refId.slice(11)}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const branchRestore = deleted.length
    ? restores.rememberMany(deleted)
    : undefined;
  let refresh = '';

  try {
    await access.repository(id).status();
  } catch {
    refresh = ' Git Native UI could not refresh. Use Refresh to reload it.';
  }

  const message = `${deleted.length ? `Deleted ${deleted.length} branch${deleted.length === 1 ? '' : 'es'}.` : 'No branches were deleted.'}${failures.length ? ` Could not delete: ${failures.join('; ')}` : ''}${refresh}`;

  return {
    kind: failures.length ? 'error' : 'success',
    backend: backends.size === 1 ? [...backends][0]! : null,
    ...(branchRestore ? { branchRestore } : {}),
    message,
  };
}
