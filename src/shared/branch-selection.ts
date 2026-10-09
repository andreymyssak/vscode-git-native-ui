export const MAX_BRANCH_SELECTION = 400;

export function isBranchDeletionSelection(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= MAX_BRANCH_SELECTION &&
    new Set(value).size === value.length &&
    value.every(
      (id) =>
        typeof id === 'string' &&
        id.startsWith('refs/heads/') &&
        id.length > 11 &&
        id.length <= 4096 &&
        !id.includes('\0'),
    )
  );
}
