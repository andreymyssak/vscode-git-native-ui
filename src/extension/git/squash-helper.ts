import { open, writeFile } from 'node:fs/promises';

import { isRecord } from '../../shared/validation';
import { validateSquashMessage } from './squash';
import type { SquashEditorInput } from './squash-editor';
import { SQUASH_HELPER_ID } from './squash-editor';

const maximumFileBytes = 8 * 1024 * 1024;
const identity = /^(?:[a-f\d]{40}|[a-f\d]{64})$/;

async function readUtf8(path: string): Promise<string> {
  const file = await open(path, 'r');

  try {
    const bytes = Buffer.alloc(maximumFileBytes + 1);
    let length = 0;

    while (length < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );

      if (!bytesRead) break;

      length += bytesRead;
    }

    if (length > maximumFileBytes)
      throw new Error(
        'Squash helper input or todo exceeds its 8 MiB file limit.',
      );

    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(0, length),
      );
    } catch (error) {
      throw new Error('Squash helper input or todo must use valid UTF-8.', {
        cause: error,
      });
    }
  } finally {
    await file.close();
  }
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && identity.test(value);
}

function parseInput(text: string): SquashEditorInput {
  let input: unknown;

  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new Error('The squash helper input is not valid JSON.', {
      cause: error,
    });
  }

  if (!isRecord(input))
    throw new Error('Invalid squash helper input manifest.');
  const shas = input.oldestToNewest;
  const message = input.message;

  if (typeof message !== 'string' || !Array.isArray(shas))
    throw new Error('Invalid squash helper input manifest.');
  if (
    shas.length < (input.operation === 'reword' ? 1 : 2) ||
    !shas.every(isIdentity)
  )
    throw new Error(
      'The squash helper input requires a full object identity range.',
    );
  const first = shas[0];

  if (
    first === undefined ||
    new Set(shas).size !== shas.length ||
    shas.some((sha) => sha.length !== first.length)
  )
    throw new Error(
      'The squash helper input requires distinct identities of one object format.',
    );
  validateSquashMessage(message);
  const replayShas = input.replayShas;
  const operation = input.operation;
  const messageCommitSha = input.messageCommitSha;

  if (
    Object.keys(input).length !== 5 ||
    (operation !== 'squash' && operation !== 'reword') ||
    !isIdentity(messageCommitSha) ||
    !Array.isArray(replayShas)
  )
    throw new Error('Invalid squash helper input manifest.');
  if (
    !replayShas.every(isIdentity) ||
    new Set(replayShas).size !== replayShas.length ||
    replayShas.some((sha) => sha.length !== first.length) ||
    shas.some((sha) => !replayShas.includes(sha)) ||
    replayShas
      .filter((sha) => shas.includes(sha))
      .some((sha, index) => sha !== shas[index]) ||
    (operation === 'reword' && shas.length !== 1)
  )
    throw new Error('Invalid approved replay identity range.');

  return {
    oldestToNewest: shas,
    replayShas,
    messageCommitSha,
    operation,
    message,
  };
}

function sequence(todo: string, input: SquashEditorInput): string {
  if (todo.includes('\0'))
    throw new Error('The Git squash todo must not contain NUL characters.');

  const replay = input.replayShas;
  const selected = new Set(input.oldestToNewest);
  const entries: string[] = [];
  const comments: string[] = [];

  for (const line of todo.split('\n')) {
    if (!line.trim() || /^[ \t]*#/.test(line)) {
      comments.push(line);
      continue;
    }

    const match =
      /^[ \t]*pick[ \t]+([a-f\d]{40}|[a-f\d]{64})(?:[ \t]+[^\r\n]*)?\r?$/.exec(
        line,
      );

    if (!match || match[1] !== replay[entries.length])
      throw new Error(
        'The Git todo does not match the approved identity range.',
      );
    entries.push(line);
  }

  if (entries.length !== replay.length)
    throw new Error(
      'The Git todo is missing an approved identity from the range.',
    );
  if (input.operation === 'reword')
    return entries
      .flatMap((line, index) =>
        selected.has(replay[index]!)
          ? [line, `fixup -C ${input.messageCommitSha}`]
          : [line],
      )
      .concat(comments)
      .join('\n');
  const gathered = replay
    .filter((sha) => selected.has(sha))
    .concat(replay.filter((sha) => !selected.has(sha)));

  return gathered
    .flatMap((sha, index) => {
      const line = entries[replay.indexOf(sha)]!;
      const command =
        index > 0 && index < selected.size
          ? line.replace(/^([ \t]*)pick(?=[ \t])/, '$1fixup')
          : line;

      return index === selected.size - 1
        ? [command, `fixup -C ${input.messageCommitSha}`]
        : [command];
    })
    .concat(comments)
    .join('\n');
}

/** Validate all private input and the complete todo before changing Git's target file. */
export async function runSquashEditor(
  mode: 'sequence' | 'message',
  inputPath: string,
  targetPath: string,
): Promise<void> {
  if (mode !== 'sequence' && mode !== 'message')
    throw new Error('Unsupported squash helper mode.');

  const input = parseInput(await readUtf8(inputPath));
  const output =
    mode === 'sequence'
      ? sequence(await readUtf8(targetPath), input)
      : input.message;

  await writeFile(targetPath, output, 'utf8');
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === 'probe') {
    process.stdout.write(`${SQUASH_HELPER_ID}\n`);

    return;
  }

  if (args.length !== 3 || (args[0] !== 'sequence' && args[0] !== 'message'))
    throw new Error(
      'Expected squash helper probe or sequence/message input target.',
    );

  await runSquashEditor(args[0], args[1]!, args[2]!);
}

if (require.main === module) {
  void main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Squash helper failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
