import { execFile } from 'node:child_process';
import { isAbsolute, win32 } from 'node:path';
import { promisify } from 'node:util';

import { SQUASH_HELPER_ID } from '../../shared/extension-identity';

/** The executable is VS Code's process.execPath; the helper belongs to its installed extension. */
export interface SquashRuntime {
  executable: string;
  helperPath: string;
}

/** Host-owned private JSON input. Object identities are full and ordered oldest first. */
export interface SquashEditorInput {
  oldestToNewest: readonly string[];
  message: string;
  replayShas: readonly string[];
  messageCommitSha: string;
  operation: 'squash' | 'reword';
}

/** Git shell commands contain trusted paths only, never repository messages or branch names. */
export interface SquashEditors {
  GIT_SEQUENCE_EDITOR: string;
  GIT_EDITOR: string;
}

export { SQUASH_HELPER_ID } from '../../shared/extension-identity';

const execute = promisify(execFile);

function quotePath(path: string): string {
  if (
    !path ||
    path.includes('\0') ||
    (!isAbsolute(path) && !win32.isAbsolute(path))
  )
    throw new Error(
      'Squash helper paths must be absolute paths without NUL characters.',
    );

  const shellPath =
    process.platform === 'win32' || /^(?:[a-z]:[\\/]|\\\\)/i.test(path)
      ? path.replaceAll('\\', '/')
      : path;

  return `'${shellPath.replaceAll("'", "'\"'\"'")}'`;
}

export function createSquashEditors(
  runtime: SquashRuntime,
  inputPath: string,
): SquashEditors {
  const launcher = `ELECTRON_RUN_AS_NODE=1 ${quotePath(runtime.executable)} ${quotePath(runtime.helperPath)}`;
  const input = quotePath(inputPath);

  return {
    GIT_SEQUENCE_EDITOR: `${launcher} sequence ${input}`,
    GIT_EDITOR: `${launcher} message ${input}`,
  };
}

/** Probe without reading Git state, with a fixed response, output cap and hard timeout. */
export async function probeSquashRuntime(
  runtime: SquashRuntime,
): Promise<void> {
  try {
    quotePath(runtime.executable);
    quotePath(runtime.helperPath);
    const result = await execute(
      runtime.executable,
      [runtime.helperPath, 'probe'],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        timeout: 3000,
        killSignal: 'SIGKILL',
        maxBuffer: 1024,
        windowsHide: true,
      },
    );

    if (result.stdout !== `${SQUASH_HELPER_ID}\n` || result.stderr)
      throw new Error('Unexpected squash helper identity response.');
  } catch (error) {
    throw new Error(
      'The squash helper runtime is unavailable. Reinstall the extension or use a supported VS Code desktop installation.',
      { cause: error },
    );
  }
}
