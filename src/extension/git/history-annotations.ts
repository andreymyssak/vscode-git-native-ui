import type { CommitRecord } from '../../shared/model';
import type { GitCli } from './cli';

export async function currentBranchCommits(
  cli: GitCli,
  id: string,
  head: string | null,
  tips: string[],
  commits: CommitRecord[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (!head || !commits.length) return [];
  if (tips.length === 1 && tips[0] === head)
    return commits.map((commit) => commit.sha);
  const wanted = new Set(commits.map((commit) => commit.sha));
  const reachable = (await cli.run(id, ['rev-list', head, '--'], signal))
    .trim()
    .split('\n')
    .filter(Boolean);

  if (reachable.some((sha) => !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha)))
    throw new Error('Git returned invalid branch ancestry.');

  return reachable.filter((sha) => wanted.has(sha));
}
