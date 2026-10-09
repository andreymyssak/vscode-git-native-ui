import type { CommitRecord } from '@contracts/model';

export function historyDestination(
  commits: readonly CommitRecord[],
  index: number,
  key: 'ArrowDown' | 'ArrowUp',
  viewportHeight: number,
) {
  const nextIndex =
    index < 0
      ? 0
      : Math.max(
          0,
          Math.min(commits.length - 1, index + (key === 'ArrowDown' ? 1 : -1)),
        );
  const next = commits[nextIndex];

  return next
    ? {
        sha: next.sha,
        scrollTop: Math.max(0, nextIndex * 22 - viewportHeight / 2),
      }
    : null;
}
