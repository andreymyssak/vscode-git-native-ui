import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { normalize } from 'node:path';
import { promisify } from 'node:util';

import type { GitApiAccess } from './api';
import type { SquashEditors } from './squash-editor';

const execute = promisify(execFile);

export class GitCli {
  constructor(private readonly access: GitApiAccess) {}
  async run(
    repositoryId: string,
    args: readonly string[],
    signal?: AbortSignal,
    beforeExecute?: () => void | Promise<void>,
    editors?: SquashEditors,
  ): Promise<string> {
    signal?.throwIfAborted();
    const repository = this.access.repository(repositoryId);
    const cwd = await realpath(repository.rootUri.fsPath);
    const options = {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      ...(signal ? { signal } : {}),
    };
    const top = (
      await execute(
        this.access.api.git.path,
        ['rev-parse', '--show-toplevel'],
        options,
      )
    ).stdout.trim();
    const canonical = (path: string) =>
      process.platform === 'win32'
        ? normalize(path).toLowerCase()
        : normalize(path);

    if (canonical(await realpath(top)) !== canonical(cwd))
      throw new Error('Repository root changed. Refresh before trying again.');
    this.access.repository(repositoryId);
    await beforeExecute?.();
    const result = await execute(this.access.api.git.path, [...args], {
      ...options,
      ...(editors
        ? {
            env: {
              ...options.env,
              GIT_SEQUENCE_EDITOR: editors.GIT_SEQUENCE_EDITOR,
              GIT_EDITOR: editors.GIT_EDITOR,
            },
          }
        : {}),
    });

    signal?.throwIfAborted();

    return result.stdout;
  }
}
