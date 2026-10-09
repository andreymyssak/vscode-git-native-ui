import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';

import type { BranchRestoreHandle, Reference } from '../../shared/model';
import type { GitApiAccess } from './api';
import type { GitCli } from './cli';
import { GitPartialCompletion } from './partial-completion';

export interface DeletedBranch {
  repositoryId: string;
  root: string;
  name: string;
  sha: string;
  upstream: string | null;
  upstreamRef: string | null;
}

/** Only deletion results can issue a repository-bound Restore capability. */
export class BranchRestores {
  private readonly records = new Map<string, readonly DeletedBranch[]>();
  constructor(
    private readonly access: GitApiAccess,
    private readonly cli: Pick<GitCli, 'run'>,
  ) {}

  async capture(id: string, ref: Reference): Promise<DeletedBranch> {
    const repo = this.access.repository(id);
    const branch = await repo.getBranch(ref.id);
    const upstream = branch.upstream;

    return {
      repositoryId: id,
      root: await realpath(repo.rootUri.fsPath),
      name: ref.name,
      sha: ref.sha,
      upstreamRef: upstream
        ? upstream.remote === '.'
          ? `refs/heads/${upstream.name}`
          : `refs/remotes/${upstream.name.startsWith(`${upstream.remote}/`) ? upstream.name : `${upstream.remote}/${upstream.name}`}`
        : null,
      upstream: upstream
        ? upstream.remote === '.'
          ? upstream.name
          : upstream.name.startsWith(`${upstream.remote}/`)
            ? upstream.name
            : `${upstream.remote}/${upstream.name}`
        : null,
    };
  }

  remember(record: DeletedBranch): BranchRestoreHandle {
    return this.rememberMany([record]);
  }

  rememberMany(records: readonly DeletedBranch[]): BranchRestoreHandle {
    if (!records.length)
      throw new Error('There are no deleted branches to restore.');
    const token = randomUUID();

    this.records.set(
      token,
      records.map((record) => ({ ...record })),
    );
    if (this.records.size > 100)
      this.records.delete(this.records.keys().next().value!);

    return {
      name: records[0]!.name,
      token,
      ...(records.length > 1
        ? { names: records.map((record) => record.name) }
        : {}),
    };
  }

  async restore(
    id: string,
    token: string,
    context?: AbortSignal,
  ): Promise<string> {
    const records = this.records.get(token);

    if (!records || records.some((record) => record.repositoryId !== id))
      throw new Error('This branch Restore is no longer available.');
    const repo = this.access.repository(id);
    const root = await realpath(repo.rootUri.fsPath);

    if (records.some((record) => record.root !== root))
      throw new Error('The original repository is no longer available.');
    const refs = await repo.getRefs({});

    for (const record of records) {
      if (refs.some((ref) => ref.type === 0 && ref.name === record.name))
        throw new Error(
          `Branch "${record.name}" already exists. Restore will not replace it.`,
        );
      if (
        (await this.cli.run(id, ['cat-file', '-t', record.sha])).trim() !==
        'commit'
      )
        throw new Error(
          'The deleted branch commit is no longer available locally.',
        );
    }

    context?.throwIfAborted();
    this.access.repository(id);
    // Consume before writing so repeated clicks cannot recreate a later deletion.
    this.records.delete(token);
    if (records.length === 1) return this.restoreOne(id, records[0]!, context);
    let restored = 0;
    const failures: string[] = [];

    for (const record of records) {
      try {
        await this.restoreOne(id, record, context);
        restored++;
      } catch (error) {
        if (error instanceof GitPartialCompletion) restored++;
        failures.push(
          `"${record.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const message = `Restored ${restored} branches.`;

    if (failures.length)
      throw new Error(
        `${message} Could not finish restoring: ${failures.join('; ')}`,
      );

    return message;
  }

  private async restoreOne(
    id: string,
    record: DeletedBranch,
    context?: AbortSignal,
  ): Promise<string> {
    context?.throwIfAborted();
    const repo = this.access.repository(id);

    if (record.name.startsWith('-'))
      await this.cli.run(
        id,
        ['branch', '--', record.name, record.sha],
        undefined,
        () => context?.throwIfAborted(),
      );
    else await repo.createBranch(record.name, false, record.sha);
    if (record.upstream) {
      try {
        await this.cli.run(id, ['show-ref', '--verify', record.upstreamRef!]);
        await this.access
          .repository(id)
          .setBranchUpstream(record.name, record.upstream);
      } catch (error) {
        throw new GitPartialCompletion(
          `Restored branch "${record.name}".`,
          'Its tracking branch could not be restored.',
          error,
        );
      }
    }

    return `Restored branch "${record.name}".`;
  }
}
