import type { GitCommit } from './api';
import type { GitCli } from './cli';

export async function readObjectParents(
  cli: Pick<GitCli, 'run'>,
  id: string,
  sha: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha))
    throw new Error('Select a full commit identity.');
  const object = await cli.run(id, ['cat-file', '-p', sha], signal);
  const header = object.split('\n\n', 1)[0]!;

  return header
    .split('\n')
    .filter((line) => line.startsWith('parent '))
    .map((line) => {
      const parent = line.slice(7);

      if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(parent))
        throw new Error('The commit contains an invalid parent identity.');

      return parent;
    });
}

export async function actualParents(
  commit: GitCommit,
  cli: Pick<GitCli, 'run'>,
  id: string,
  signal?: AbortSignal,
): Promise<string[]> {
  // Native %P omits parents at a shallow boundary even when the object exists.
  return commit.parents.length
    ? [...commit.parents]
    : readObjectParents(cli, id, commit.hash, signal);
}
