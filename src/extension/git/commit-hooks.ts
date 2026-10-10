import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { GitCli } from './cli';

const guardedHooks = new Set([
  'pre-commit',
  'prepare-commit-msg',
  'commit-msg',
]);

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellPath(path: string): string {
  return process.platform === 'win32' ? path.replaceAll('\\', '/') : path;
}

async function originalHooks(directory: string): Promise<Map<string, string>> {
  const hooks = new Map<string, string>();
  let names: string[];

  try {
    names = await readdir(directory);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return hooks;
    throw error;
  }

  for (const name of names) {
    const path = join(directory, name);
    const info = await stat(path).catch((error: unknown) => {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      )
        return null;
      throw error;
    });

    if (
      info?.isFile() &&
      (process.platform === 'win32' || (info.mode & 0o111) !== 0)
    )
      hooks.set(name, shellPath(path));
  }

  return hooks;
}

interface CommitTarget {
  head: string | null;
  branch: string;
  base: string;
  paths: readonly string[];
}

/** Run original hooks, guard their staging, and record the commit before reference hooks can move HEAD. */
export async function withCheckedCommitHooks(
  cli: GitCli,
  id: string,
  target: CommitTarget,
  commit: (hooksPath: string) => Promise<unknown>,
): Promise<string> {
  const root = (await cli.run(id, ['rev-parse', '--show-toplevel'])).trim();
  const configured = (
    await cli.run(id, ['rev-parse', '--git-path', 'hooks'])
  ).trim();
  const originals = await originalHooks(resolve(root, configured));
  const directory = await mkdtemp(join(tmpdir(), 'git-ui-commit-hooks-'));
  const record = join(directory, 'created-commit');
  const git = quote(shellPath(cli.executablePath));
  const stateGuard = [
    `actual_head=$(${git} rev-parse --verify HEAD 2>/dev/null || :)`,
    `actual_branch=$(${git} symbolic-ref --quiet HEAD || :)`,
    `if [ "$actual_head" != ${quote(target.head ?? '')} ] || [ "$actual_branch" != ${quote(target.branch)} ]; then`,
    '  printf "%s\\n" "HEAD or its branch changed in a Git hook. The checked-file commit was cancelled." >&2',
    '  exit 1',
    'fi',
  ].join('\n');
  const scopeGuard = [
    `${git} diff-index --cached --quiet --no-ext-diff ${quote(target.base)} -- . ${target.paths.map((path) => quote(`:(top,exclude,literal)${path}`)).join(' ')}`,
    'result=$?',
    'if [ "$result" -ne 0 ]; then',
    '  printf "%s\\n" "A Git hook staged unchecked files. The checked-file commit was cancelled; review the hook and selection." >&2',
    '  exit "$result"',
    'fi',
  ].join('\n');
  const createdSha = async () => {
    const sha = (await readFile(record, 'utf8')).trim();

    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))
      throw new Error('Git returned an invalid created commit identity.');

    return sha;
  };

  try {
    for (const name of new Set([
      ...originals.keys(),
      ...guardedHooks,
      'post-commit',
      'reference-transaction',
    ])) {
      const original = originals.get(name);

      if (name === 'reference-transaction') {
        const inputTemplate = quote(
          shellPath(join(directory, 'reference-input.XXXXXX')),
        );
        const script = [
          '#!/bin/sh',
          `transaction_input=$(mktemp ${inputTemplate}) || exit $?`,
          'trap \'rm -f "$transaction_input"\' EXIT',
          'cat > "$transaction_input" || exit $?',
          `if [ "$1" = committed ] && [ ! -f ${quote(shellPath(record))} ]; then`,
          '  while IFS=" " read -r old new ref; do',
          `    if [ "$old" = ${quote(target.head ?? '0'.repeat(target.base.length))} ] && [ "$ref" = ${quote(target.branch || 'HEAD')} ]; then`,
          `      printf "%s\\n" "$new" > ${quote(shellPath(record))}`,
          '      break',
          '    fi',
          '  done < "$transaction_input"',
          'fi',
          original
            ? `${quote(original)} "$@" < "$transaction_input"`
            : 'exit 0',
        ].join('\n');

        await writeFile(join(directory, name), `${script}\n`, { mode: 0o755 });
        continue;
      }

      const delegate = original
        ? `${quote(original)} "$@"\nresult=$?\nif [ "$result" -ne 0 ]; then exit "$result"; fi\n`
        : '';
      const before = guardedHooks.has(name) ? stateGuard : '';
      const after = guardedHooks.has(name)
        ? `${stateGuard}\n${scopeGuard}`
        : '';

      await writeFile(
        join(directory, name),
        `#!/bin/sh\n${before}\n${delegate}${after}\n`,
        { mode: 0o755 },
      );
    }

    try {
      await commit(directory);
    } catch (error) {
      const sha = await createdSha().catch(() => null);

      if (sha)
        throw new Error(
          `Commit ${sha} was created, but Git reported a later failure. Review Source Control; do not repeat the commit.`,
          { cause: error },
        );
      throw error;
    }

    try {
      return await createdSha();
    } catch (error) {
      throw new Error(
        'Git finished committing, but its created commit identity could not be verified. Review Source Control; do not repeat the commit.',
        { cause: error },
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
