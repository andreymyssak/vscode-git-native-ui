import type { CommitRangeTarget } from '../../shared/model';
import type { GitApiAccess } from './api';
import type { GitCli } from './cli';
import type { CommitRewriteSnapshot as SquashSnapshot } from './commit-rewrite';
import { validateRewriteRange } from './commit-rewrite';
import { attachedBranch, readCommit } from './commit-suffix';

export type { CommitRewriteSnapshot as SquashSnapshot } from './commit-rewrite';

type SquashCli = Pick<GitCli, 'run'>;

export function supportsSquashGit(version: string): boolean {
  const match =
    /^(?:git version )?(\d+)\.(\d+)\.(\d+)(?:\.windows\.\d+)?(?: \([^\n]+\))?$/.exec(
      version.trim(),
    );

  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);

  return major > 2 || (major === 2 && minor >= 47);
}

export function validateSquashMessage(message: string): void {
  if (!message.trim()) throw new Error('The squash message must not be blank.');

  if (message.includes('\0'))
    throw new Error('The squash message must not contain NUL characters.');

  if (Buffer.byteLength(message, 'utf8') > 1024 * 1024)
    throw new Error('The squash message must not exceed 1 MiB.');
}

export async function validateSquash(
  access: GitApiAccess,
  cli: SquashCli,
  id: string,
  target: CommitRangeTarget,
): Promise<SquashSnapshot> {
  if (!supportsSquashGit(await cli.run(id, ['--version'])))
    throw new Error(
      'Squashing requires Git 2.47 or newer. Existing browsing remains available.',
    );

  return validateRewriteRange(access, cli, id, target, 2);
}

export async function verifySquash(
  cli: SquashCli,
  id: string,
  snapshot: SquashSnapshot,
): Promise<string> {
  let replacementSha = 'unavailable';

  try {
    replacementSha = (
      await cli.run(id, ['rev-parse', '--verify', 'HEAD^{commit}'])
    ).trim();

    const range = (
      await cli.run(id, [
        'rev-list',
        '--reverse',
        `${snapshot.oldestParentSha}..${replacementSha}`,
      ])
    )
      .trim()
      .split('\n');
    const expectedCount = snapshot.replayShas.length - snapshot.shas.length + 1;

    if ((await attachedBranch(cli, id)) !== snapshot.expectedBranch)
      throw new Error('The checked-out branch changed.');
    if (range.length !== expectedCount)
      throw new Error(
        'Expected the combined commit and all retained descendants.',
      );
    const combined = await readCommit(cli, id, range[0]!);
    const head = await readCommit(cli, id, replacementSha);

    if (
      combined.parents.length !== 1 ||
      combined.parents[0] !== snapshot.oldestParentSha
    )
      throw new Error('The replacement has a different base parent.');
    if (head.treeSha !== snapshot.treeSha)
      throw new Error(
        'The replacement tree differs from the former HEAD tree.',
      );
    replacementSha = range[0]!;

    return replacementSha;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Squash verification failed. Old HEAD ${snapshot.expectedHeadSha}; new HEAD ${replacementSha}. ${reason}`,
      { cause: error },
    );
  }
}
