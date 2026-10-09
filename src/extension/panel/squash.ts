import type { Request, RequestBody } from '../../shared/messages';
import type { GitAction } from '../../shared/model';
import type { GitAdapter } from '../git/adapter';
import { validateSquashMessage } from '../git/squash';
import type { QuerySession } from './queries';

export interface ReviewedSquash {
  action: Extract<GitAction, { kind: 'squash-commits' }>;
  context: AbortSignal;
}
export async function reviewSquash(options: {
  adapter: Pick<GitAdapter, 'prepareSquash'>;
  session: QuerySession;
  request: Request<RequestBody>;
  shas: readonly string[];
  activeSha: string;
  askMessage: (
    draft: string,
    branch: string,
    count: number,
  ) => Promise<string | null>;
}): Promise<ReviewedSquash | null> {
  const { adapter, session, request, activeSha, askMessage } = options;
  const shas = [...options.shas];
  const repository = session.repositoryInfo;
  const revision = session.rangeRevision;
  const context = AbortSignal.any([
    session.abort.signal,
    session.rangeAbort.signal,
  ]);
  const sameRange = () =>
    session.selectedShas.length === shas.length &&
    session.selectedShas.every((sha, index) => sha === shas[index]);
  const current = () =>
    session.current(request.repositoryId, request.generation) &&
    !context.aborted &&
    session.rangeRevision === revision &&
    sameRange() &&
    session.repositoryInfo?.branch === repository?.branch &&
    session.repositoryInfo?.headSha === repository?.headSha;

  if (
    !repository?.branch ||
    repository.id !== request.repositoryId ||
    !repository.headSha ||
    shas.length < 2 ||
    new Set(shas).size !== shas.length ||
    !shas.includes(activeSha) ||
    session.selectedSha !== activeSha ||
    !shas.every((sha) => session.commits.has(sha)) ||
    !current()
  )
    throw new Error(
      'Select a loaded commit range in the current history and branch context.',
    );
  const target = {
    shas,
    expectedBranch: repository.branch,
    expectedHeadSha: repository.headSha,
  };
  const snapshot = await adapter.prepareSquash(request.repositoryId, target);

  if (!current())
    throw new Error(
      'The commit range or history context changed before message review. Select the range again.',
    );
  const draft = snapshot.messages.join('\n\n');
  const message = await askMessage(draft, repository.branch, shas.length);

  if (message === null) return null;
  if (!current())
    throw new Error(
      'The commit range, branch or HEAD changed while the message editor was open. Select the range again.',
    );
  validateSquashMessage(message);

  return { action: { kind: 'squash-commits', target, message }, context };
}
