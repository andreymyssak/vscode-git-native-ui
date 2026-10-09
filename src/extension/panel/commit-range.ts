import type { Request, RequestBody } from '../../shared/messages';
import type { QuerySession } from './queries';

/** Owns the whole selection and its lifetime, independently of the active row. */
export function captureCommitRange(
  session: QuerySession,
  request: Request<RequestBody>,
  shas: readonly string[],
  activeSha: string,
) {
  const repository = session.repositoryInfo;
  const revision = session.rangeRevision;
  const selected = [...shas];
  const context = AbortSignal.any([
    session.abort.signal,
    session.rangeAbort.signal,
  ]);
  const current = () =>
    session.current(request.repositoryId, request.generation) &&
    !context.aborted &&
    session.rangeRevision === revision &&
    session.selectedShas.length === selected.length &&
    session.selectedShas.every((sha, index) => sha === selected[index]) &&
    session.repositoryInfo?.branch === repository?.branch &&
    session.repositoryInfo?.headSha === repository?.headSha;

  if (
    !repository?.branch ||
    !repository.headSha ||
    repository.id !== request.repositoryId ||
    !selected.length ||
    new Set(selected).size !== selected.length ||
    !selected.includes(activeSha) ||
    session.selectedSha !== activeSha ||
    !selected.every((sha) => session.commits.has(sha)) ||
    !current()
  )
    throw new Error(
      'Select a loaded commit range in the current history and branch context.',
    );

  return {
    context,
    current,
    target: {
      shas: selected,
      expectedBranch: repository.branch,
      expectedHeadSha: repository.headSha,
    },
  };
}
