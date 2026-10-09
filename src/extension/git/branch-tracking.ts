import type { Reference } from '../../shared/model';
import type { GitCli } from './cli';

/** One local query for all tracked branches; no network or per-branch subprocesses. */
export async function readBranchTracking(cli: Pick<GitCli, 'run'>, id: string) {
  const output = await cli.run(id, [
    'for-each-ref',
    '--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track,nobracket)',
    'refs/heads',
  ]);
  const result = new Map<
    string,
    { sha: string; tracking: NonNullable<Reference['tracking']> }
  >();

  for (const line of output.split('\n')) {
    const [ref, sha, upstream, raw = ''] = line.split('\0');

    if (!ref || !sha || !upstream) continue;
    const track = raw.replace(/^\[|\]$/g, '');
    const unknown = track === 'gone';
    const ahead = /ahead (\d+)/.exec(track);
    const behind = /behind (\d+)/.exec(track);

    result.set(ref, {
      sha,
      tracking: {
        upstream,
        ahead: unknown ? null : Number(ahead?.[1] ?? 0),
        behind: unknown ? null : Number(behind?.[1] ?? 0),
      },
    });
  }

  return result;
}
