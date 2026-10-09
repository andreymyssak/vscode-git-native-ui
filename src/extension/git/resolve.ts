import type {
  CommitRecord,
  Reference,
  ResolveResult,
} from '../../shared/model';
import type { GitApiAccess, GitCommit } from './api';
import { readBranchTracking } from './branch-tracking';
import type { GitCli } from './cli';
import { actualParents } from './parents';

export async function commitRecord(
  commit: GitCommit,
  cli: GitCli,
  id: string,
  signal?: AbortSignal,
): Promise<CommitRecord> {
  return {
    sha: commit.hash,
    parents: await actualParents(commit, cli, id, signal),
    message: commit.message,
    authorName: commit.authorName ?? null,
    authorEmail: commit.authorEmail ?? null,
    authorDate: commit.authorDate?.toISOString() ?? null,
    commitDate: commit.commitDate?.toISOString() ?? null,
  };
}

export async function readReferences(
  access: GitApiAccess,
  id: string,
  cli?: Pick<GitCli, 'run'>,
): Promise<Reference[]> {
  const refs = await access.repository(id).getRefs({});

  const tracking = cli
    ? await readBranchTracking(cli, id)
    : new Map<
        string,
        { sha: string; tracking: NonNullable<Reference['tracking']> }
      >();

  return refs.flatMap((ref) => {
    if (!ref.name || !ref.commit) return [];
    const kind = ref.type === 0 ? 'local' : ref.type === 1 ? 'remote' : 'tag';
    const name = ref.name;
    const group =
      kind === 'local' ? 'heads' : kind === 'remote' ? 'remotes' : 'tags';

    return [
      {
        id: `refs/${group}/${name}`,
        name,
        kind,
        sha: ref.commit,
        remote: ref.remote ?? null,
        ...(kind === 'local' &&
        tracking.get(`refs/heads/${name}`)?.sha === ref.commit
          ? { tracking: tracking.get(`refs/heads/${name}`)!.tracking }
          : {}),
      },
    ];
  });
}

export async function resolveCommit(
  access: GitApiAccess,
  cli: GitCli,
  id: string,
  input: string,
): Promise<ResolveResult> {
  const refs = await readReferences(access, id);
  const choices = refs.filter((ref) => ref.name === input || ref.id === input);

  if (choices.length > 1) return { kind: 'choices', references: choices };
  const selected = choices[0];

  if (selected)
    return {
      kind: 'commit',
      commit: await commitRecord(
        await access.repository(id).getCommit(selected.sha),
        cli,
        id,
      ),
    };
  if (!/^[a-f\d]{4,64}$/i.test(input))
    return {
      kind: 'missing',
      message:
        'Enter a known branch, tag, or at least four hexadecimal hash characters.',
    };
  const candidates = (
    await cli.run(id, [`rev-parse`, `--disambiguate=${input.toLowerCase()}`])
  )
    .trim()
    .split('\n')
    .filter((sha) => /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha));
  const commits: string[] = [];

  for (const sha of candidates)
    if ((await cli.run(id, ['cat-file', '-t', sha])).trim() === 'commit')
      commits.push(sha);
  if (commits.length > 1)
    return {
      kind: 'ambiguous',
      message:
        'This hash prefix identifies several commits. Enter more characters.',
    };
  const sha = commits[0];

  if (!sha) return { kind: 'missing', message: 'No commit matches this hash.' };

  return {
    kind: 'commit',
    commit: await commitRecord(
      await access.repository(id).getCommit(sha),
      cli,
      id,
    ),
  };
}
