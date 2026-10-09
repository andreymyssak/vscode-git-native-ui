export interface CommitRange {
  selectedShas: readonly string[];
  activeSha: string | null;
  anchorSha: string | null;
}

export type CommitGesture = 'plain' | 'extend' | 'context';

export function singleCommitRange(sha: string | null): CommitRange {
  return { selectedShas: sha ? [sha] : [], activeSha: sha, anchorSha: sha };
}

export function selectCommitRange(
  range: CommitRange,
  orderedShas: readonly string[],
  sha: string,
  gesture: CommitGesture,
): CommitRange {
  const endpoint = orderedShas.indexOf(sha);

  if (endpoint < 0) return range;

  if (gesture === 'context' && range.selectedShas.includes(sha))
    return { ...range, activeSha: sha };

  const anchor = range.anchorSha ? orderedShas.indexOf(range.anchorSha) : -1;

  if (gesture !== 'extend' || anchor < 0) return singleCommitRange(sha);

  return {
    selectedShas: orderedShas.slice(
      Math.min(anchor, endpoint),
      Math.max(anchor, endpoint) + 1,
    ),
    activeSha: sha,
    anchorSha: range.anchorSha,
  };
}
