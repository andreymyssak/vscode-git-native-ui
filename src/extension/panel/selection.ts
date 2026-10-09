import type { Selection } from '../../shared/model';

export interface MembershipResult {
  inQuery: boolean;
  parents: readonly string[];
  files: readonly string[];
}
export function reconcileSelection(
  selection: Selection,
  membership: MembershipResult,
): Selection | null {
  if (!membership.inQuery) return null;
  const parentSha =
    selection.parentSha !== null &&
    membership.parents.includes(selection.parentSha)
      ? selection.parentSha
      : (membership.parents[0] ?? null);

  return {
    ...selection,
    parentSha,
    filePath:
      selection.filePath !== null &&
      membership.files.includes(selection.filePath)
        ? selection.filePath
        : null,
  };
}
