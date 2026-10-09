import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'esbuild';
import { afterAll, assert, beforeAll, expect, test } from 'vitest';

import type {
  SquashEditorInput,
  SquashRuntime,
} from '../../src/extension/git/squash-editor';
import {
  createSquashEditors,
  probeSquashRuntime,
} from '../../src/extension/git/squash-editor';
import type { runSquashEditor as RunSquashEditor } from '../../src/extension/git/squash-helper';
import { buildHelperFixture } from '../fixtures/helper-build';

const execute = promisify(execFile);

const shas = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];

function squashInput(
  identities = shas,
  message = 'Combined',
): SquashEditorInput {
  return {
    operation: 'squash',
    oldestToNewest: identities,
    replayShas: identities,
    messageCommitSha: 'd'.repeat(identities[0]!.length),
    message,
  };
}

let root: string;

let helperPath: string;

let runSquashEditor: typeof RunSquashEditor;

let built: Awaited<ReturnType<typeof buildHelperFixture<'helper'>>>;

beforeAll(async () => {
  built = await buildHelperFixture(
    { helper: 'src/extension/git/squash-helper.ts' },
    "git-native-ui helper ü ' ",
  );
  root = built.directory;
  helperPath = built.paths.helper;
  ({ runSquashEditor } = await import(pathToFileURL(helperPath).href));
});

afterAll(async () => {
  await built?.dispose();
});

async function files(input: unknown = squashInput(), todo = '') {
  const directory = await mkdtemp(join(root, 'operation '));
  const inputPath = join(directory, "approved ' ü.json");
  const targetPath = join(directory, "Git target ' ü");

  await writeFile(inputPath, JSON.stringify(input));
  await writeFile(targetPath, todo);

  return { inputPath, targetPath, directory };
}

test('sequence combines the approved range with its message and retains Git comments', async () => {
  const todo = `# Git instructions\npick ${shas[0]} first\n\npick ${shas[1]} second\npick ${shas[2]} third\n# end\n`;
  const { inputPath, targetPath } = await files(undefined, todo);

  await runSquashEditor('sequence', inputPath, targetPath);
  expect(await readFile(targetPath, 'utf8')).toBe(
    `pick ${shas[0]} first\nfixup ${shas[1]} second\nfixup ${shas[2]} third\nfixup -C ${'d'.repeat(40)}\n# Git instructions\n\n# end\n`,
  );
});

test('sequence supports full SHA-256 identities and CRLF comments', async () => {
  const identities = ['1'.repeat(64), '2'.repeat(64)];
  const todo = `pick ${identities[0]} one\r\npick ${identities[1]} two\r\n# retain\r\n`;
  const { inputPath, targetPath } = await files(squashInput(identities), todo);

  await runSquashEditor('sequence', inputPath, targetPath);
  expect(await readFile(targetPath, 'utf8')).toBe(
    `pick ${identities[0]} one\r\nfixup ${identities[1]} two\r\nfixup -C ${'d'.repeat(64)}\n# retain\r\n`,
  );
});

test('sequence refuses every changed range without altering the todo', async () => {
  for (const identities of [
    [shas[0], shas[1]],
    [...shas, 'd'.repeat(40)],
    [shas[1], shas[0], shas[2]],
    [shas[0], shas[0], shas[2]],
    [shas[0]!.slice(0, 7), shas[1], shas[2]],
    [shas[0], 'd'.repeat(40), shas[2]],
  ]) {
    const todo = identities.map((sha) => `pick ${sha} subject`).join('\n');
    const { inputPath, targetPath } = await files(undefined, todo);

    await expect(
      runSquashEditor('sequence', inputPath, targetPath),
    ).rejects.toThrow(/todo|range|identity/i);
    expect(await readFile(targetPath, 'utf8')).toBe(todo);
  }
});

test('executable or unfamiliar commands cannot run or alter the todo', async () => {
  const sentinel = join(root, 'must-not-exist');

  for (const command of [
    `exec touch '${sentinel}'`,
    `drop ${shas[1]}`,
    `s ${shas[1]}`,
    `label arbitrary`,
    `reset arbitrary`,
    'malformed',
    `pick ${shas[0]}\0 body`,
  ]) {
    const todo = `${shas.map((sha) => `pick ${sha} subject`).join('\n')}\n${command}\n`;
    const { inputPath, targetPath } = await files(undefined, todo);

    await expect(
      runSquashEditor('sequence', inputPath, targetPath),
    ).rejects.toThrow(/todo|command|NUL/i);
    expect(await readFile(targetPath, 'utf8')).toBe(todo);
    await expect(stat(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

test('message mode writes the exact approved literal multiline draft', async () => {
  const sentinel = join(root, 'literal-message-must-not-run');
  const message = `  Combined ü\n\n$(touch '${sentinel}') "quoted" 'single'\n  `;
  const { inputPath, targetPath } = await files(
    squashInput(shas, message),
    'Git draft',
  );

  await runSquashEditor('message', inputPath, targetPath);
  expect(await readFile(targetPath, 'utf8')).toBe(message);
  await expect(stat(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('malformed manifests and unsafe messages leave both targets unchanged', async () => {
  const valid = squashInput();

  for (const input of [
    null,
    [],
    {},
    { ...valid, operation: undefined },
    { ...valid, replayShas: undefined },
    { ...valid, extra: 'exec' },
    { ...valid, oldestToNewest: [shas[0]] },
    { ...valid, oldestToNewest: [shas[0], shas[0]] },
    { ...valid, oldestToNewest: ['abc', shas[0]] },
    { ...valid, oldestToNewest: [shas[0], 'b'.repeat(64)] },
    { ...valid, message: false },
    { ...valid, message: ' \n\t' },
    { ...valid, message: 'NUL\0body' },
    { ...valid, message: 'é'.repeat(524289) },
  ]) {
    const { inputPath, targetPath } = await files(input, 'unchanged');

    for (const mode of ['sequence', 'message'] as const) {
      await expect(
        runSquashEditor(mode, inputPath, targetPath),
      ).rejects.toThrow(
        /input|manifest|message|identity|identities|range|1 MiB|NUL|blank/i,
      );
      expect(await readFile(targetPath, 'utf8')).toBe('unchanged');
    }
  }
});

test('invalid JSON and invalid UTF-8 reject before touching the Git target', async () => {
  for (const bytes of [
    Buffer.from('{broken'),
    Buffer.from([0xff, 0xfe, 0x61]),
  ]) {
    const { inputPath, targetPath } = await files(undefined, 'unchanged');

    await writeFile(inputPath, bytes);
    await expect(
      runSquashEditor('message', inputPath, targetPath),
    ).rejects.toThrow(/input|JSON|UTF-8/i);
    expect(await readFile(targetPath, 'utf8')).toBe('unchanged');
  }
});

test('the exact UTF-8 byte limit is accepted without changing its bytes', async () => {
  const message = 'é'.repeat(524288);
  const { inputPath, targetPath } = await files(squashInput(shas, message));

  await runSquashEditor('message', inputPath, targetPath);
  expect(await readFile(targetPath)).toStrictEqual(Buffer.from(message));
});

test('probe identifies the standalone helper without changing the global environment', async () => {
  const electronMode = process.env.ELECTRON_RUN_AS_NODE;
  const runtime = { executable: process.execPath, helperPath };

  await probeSquashRuntime(runtime);
  const result = await execute(runtime.executable, [helperPath, 'probe'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });

  expect(result.stdout).toBe('git-native-ui-squash-helper\n');
  expect(process.env.ELECTRON_RUN_AS_NODE).toBe(electronMode);
});

test('probe refuses an unrelated executable and bounds output and execution time', async () => {
  const fakeHelper = join(root, 'unusable.cjs');

  for (const body of [
    "console.log('unrelated executable')",
    "process.stdout.write('x'.repeat(2048))",
    'setInterval(() => {}, 100)',
  ]) {
    await writeFile(fakeHelper, body);
    const start = Date.now();

    await expect(
      probeSquashRuntime({
        executable: process.execPath,
        helperPath: fakeHelper,
      }),
    ).rejects.toThrow(/squash helper|runtime/i);
    assert.ok(Date.now() - start < 6000, 'probe must have a bounded timeout');
  }
});

test('Git shell commands launch quoted helper/input/executable paths and leave message commands literal', async (context) => {
  if (process.platform === 'win32')
    return context.skip(
      'Actual Git for Windows launch is covered by the native runtime fixture.',
    );
  const directory = join(root, "runtime ' ü $() &");
  const executable = join(directory, "node ' ü $() &");
  const nestedHelper = join(directory, 'squash-helper.cjs');

  await mkdir(directory);
  await symlink(process.execPath, executable);
  await copyFile(helperPath, nestedHelper);
  const sentinel = join(root, 'shell-must-not-exist');
  const input = squashInput(shas, `Message $(touch '${sentinel}') ü\nbody`);
  const { inputPath, targetPath } = await files(
    input,
    shas.map((sha) => `pick ${sha} subject`).join('\n'),
  );
  const runtime: SquashRuntime = { executable, helperPath: nestedHelper };
  const editors = createSquashEditors(runtime, inputPath);
  const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

  await probeSquashRuntime(runtime);
  await execute('/bin/sh', [
    '-c',
    `${editors.GIT_SEQUENCE_EDITOR} ${quote(targetPath)}`,
  ]);
  expect(await readFile(targetPath, 'utf8')).toMatch(
    /^pick .+\nfixup .+\nfixup .+\nfixup -C /,
  );
  await execute('/bin/sh', [
    '-c',
    `${editors.GIT_EDITOR} ${quote(targetPath)}`,
  ]);
  expect(await readFile(targetPath, 'utf8')).toBe(input.message);
  await expect(stat(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('the Windows path API still produces forward-slash Git editor commands', async () => {
  const editorPath = join(root, 'runtime-editor.cjs');

  await build({
    entryPoints: [resolve('src/extension/git/squash-editor.ts')],
    outfile: editorPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
  });
  // Simulate the path API used by Node on Windows. Actual native execution is a separate gate.
  const script = `const path = require('node:path'); path.isAbsolute = path.win32.isAbsolute; const editor = require(process.argv[1]); console.log(JSON.stringify(editor.createSquashEditors({ executable: 'C:\\\\Program Files\\\\VS Code\\\\Code.exe', helperPath: 'C:\\\\Private Inputs\\\\squash-helper.cjs' }, 'C:\\\\Private Inputs\\\\input.json')));`;
  const result = await execute(process.execPath, ['-e', script, editorPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });

  assert.ok(
    !result.stdout.includes('\\'),
    'Git for Windows needs shell-compatible forward slashes',
  );
});

test('oversized private inputs and todos reject without modifying Git targets', async () => {
  for (const part of ['input', 'todo']) {
    const { inputPath, targetPath } = await files(undefined, 'unchanged');
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 0x20);

    if (part === 'input') await writeFile(inputPath, oversized);
    else await writeFile(targetPath, oversized);
    await expect(
      runSquashEditor(
        part === 'input' ? 'message' : 'sequence',
        inputPath,
        targetPath,
      ),
    ).rejects.toThrow(/8 MiB/);
    expect(await readFile(targetPath)).toStrictEqual(
      part === 'input' ? Buffer.from('unchanged') : oversized,
    );
  }
});

test('standalone helper refuses unknown modes or argument counts without touching a file', async () => {
  const { inputPath, targetPath } = await files(undefined, 'unchanged');

  for (const args of [
    ['unknown', inputPath, targetPath],
    ['probe', inputPath],
    ['message', inputPath],
    ['sequence', inputPath, targetPath, 'extra'],
  ]) {
    await expect(
      execute(process.execPath, [helperPath, ...args], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      }),
    ).rejects.toThrow();
    expect(await readFile(targetPath, 'utf8')).toBe('unchanged');
  }
});

test('replay manifests reject forged message carriers and reordered or foreign identities before altering Git files', async () => {
  const valid = {
    operation: 'squash',
    oldestToNewest: [shas[0], shas[2]],
    replayShas: shas,
    message: 'Reviewed',
    messageCommitSha: 'd'.repeat(40),
  };

  for (const manifest of [
    { ...valid, messageCommitSha: 'd; exec malicious' },
    { ...valid, messageCommitSha: undefined },
    { ...valid, oldestToNewest: [shas[2], shas[0]] },
    { ...valid, oldestToNewest: [shas[0], 'f'.repeat(40)] },
    { ...valid, replayShas: [shas[0], shas[0], shas[2]] },
    { ...valid, operation: 'reword' },
  ]) {
    const { inputPath, targetPath } = await files(manifest, 'unchanged');

    await expect(
      runSquashEditor('sequence', inputPath, targetPath),
    ).rejects.toThrow(/input|manifest|range|identity/i);
    expect(await readFile(targetPath, 'utf8')).toBe('unchanged');
  }
});
