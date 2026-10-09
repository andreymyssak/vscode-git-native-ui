import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { OperationResult, WorktreeInfo } from '../../shared/model';
import {
  canDeleteWorktree,
  isWorktreeSelection,
} from '../../shared/worktree-selection';
import type { GitApiAccess } from './api';
import type { GitCli } from './cli';
import { containsRoot, pathKey, sameRoot } from './paths';

export async function readWorktrees(
  access: GitApiAccess,
  cli: Pick<GitCli, 'run'>,
  id: string,
): Promise<WorktreeInfo[]> {
  const repo = access.repository(id);
  const current = await realpath(repo.rootUri.fsPath);
  const native = repo.state.worktrees;
  // API state is an event snapshot. Verify existing entries and new entries with
  // the installed Git before listing/opening; this read does not emit status events.
  const output = await cli.run(id, ['worktree', 'list', '--porcelain', '-z']);
  const entries: WorktreeInfo[] = [];
  const roots = new Map<string, string>();

  for (const record of output.split('\0\0')) {
    const fields = record.split('\0');
    const path = fields
      .find((field) => field.startsWith('worktree '))
      ?.slice(9);

    if (!path) continue;
    let canonical = path;
    let available = false;

    try {
      canonical = await realpath(path);
      available = (await stat(canonical)).isDirectory();
    } catch {
      /* Listed but unavailable folders remain visible. */
    }

    const branch =
      fields
        .find((field) => field.startsWith('branch '))
        ?.slice(7)
        .replace(/^refs\/heads\//, '') ?? null;
    const original = native.find((item) => sameRoot(item.path, path));

    roots.set(pathToFileURL(path).href, canonical);
    entries.push({
      id: createHash('sha256')
        .update(id + '\0' + pathKey(path))
        .digest('hex'),
      name: original?.name ?? basename(path),
      rootUri: pathToFileURL(path).href,
      branch,
      current: sameRoot(canonical, current),
      available,
      main: entries.length === 0,
      locked: fields.some(
        (field) => field === 'locked' || field.startsWith('locked '),
      ),
    });
  }

  const openPaths = await Promise.all(
    (access.worktreeProtectionPaths?.() ?? []).map(async (path) => {
      try {
        return await realpath(path);
      } catch {
        return path;
      }
    }),
  );

  for (const item of entries) {
    const root = roots.get(item.rootUri)!;

    if (openPaths.some((path) => containsRoot(root, path)))
      item.deletionBlocked = 'This worktree is open in this window.';
    else if (
      entries.some(
        (other) =>
          other.id !== item.id && containsRoot(root, roots.get(other.rootUri)!),
      )
    )
      item.deletionBlocked = 'This worktree contains another worktree.';
  }

  return entries;
}

export async function deleteWorktrees(
  access: GitApiAccess,
  cli: Pick<GitCli, 'run'>,
  id: string,
  targets: readonly Pick<WorktreeInfo, 'id' | 'rootUri'>[],
  context?: AbortSignal,
): Promise<OperationResult> {
  if (!isWorktreeSelection(targets.map((target) => target.id)))
    throw new Error('Select worktrees from the current list.');
  const fresh = await readWorktrees(access, cli, id);
  const resolve = (target: (typeof targets)[number], list: WorktreeInfo[]) => {
    const item = list.find((candidate) => candidate.id === target.id);

    if (!item || item.rootUri !== target.rootUri)
      throw new Error('The worktree list changed. Select it again.');
    if (!canDeleteWorktree(item))
      throw new Error(
        item.deletionBlocked ??
          'The current, main or locked worktree cannot be deleted.',
      );

    return item;
  };

  for (const target of targets) resolve(target, fresh);
  let removed = 0;
  const failures: string[] = [];

  for (const target of targets) {
    if (context?.aborted) {
      if (!removed) return { kind: 'cancelled', backend: null };
      failures.push('Remaining worktrees were not deleted.');
      break;
    }

    try {
      const item = resolve(target, await readWorktrees(access, cli, id));

      await cli.run(
        id,
        ['worktree', 'remove', '--', fileURLToPath(item.rootUri)],
        undefined,
        () => context?.throwIfAborted(),
      );
      removed++;
    } catch (error) {
      if (context?.aborted && error === context.reason) {
        if (!removed) return { kind: 'cancelled', backend: null };
        failures.push('Remaining worktrees were not deleted.');
        break;
      }

      const message = error instanceof Error ? error.message : String(error);
      const name = fresh.find((item) => item.id === target.id)!.name;

      failures.push(
        /modified or.*untracked|contains.*changes/s.test(message)
          ? `"${name}" has local changes. Commit or stash them first.`
          : `Could not delete "${name}": ${message}`,
      );
    }
  }

  try {
    await access.repository(id).status();
  } catch {
    failures.push('The list could not refresh. Use Refresh to reload it.');
  }

  return {
    kind: failures.length ? 'error' : 'success',
    backend: 'cli',
    message: [
      ...(removed
        ? [`Deleted ${removed} worktree${removed === 1 ? '' : 's'}.`]
        : []),
      ...failures,
    ].join(' '),
  };
}
