import type { WorktreeInfo } from './model';

export function isWorktreeSelection(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 400 &&
    new Set(value).size === value.length &&
    value.every(
      (id) =>
        typeof id === 'string' &&
        id.length > 0 &&
        id.length <= 128 &&
        !id.includes('\0'),
    )
  );
}

export function canOpenWorktree(item: WorktreeInfo): boolean {
  return item.available && !item.current;
}

export function canDeleteWorktree(item: WorktreeInfo): boolean {
  return (
    item.main === false &&
    !item.current &&
    !item.locked &&
    !item.deletionBlocked
  );
}
