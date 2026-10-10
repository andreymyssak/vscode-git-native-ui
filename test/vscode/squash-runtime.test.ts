import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import * as vscode from 'vscode';

import { getGitApi } from '../../src/extension/git/api';
import type {
  SquashEditorInput,
  SquashRuntime,
} from '../../src/extension/git/squash-editor';
import {
  createSquashEditors,
  probeSquashRuntime,
} from '../../src/extension/git/squash-editor';
import type { Fixture } from '../fixtures/repository';
import { createFixture } from '../fixtures/repository';

const execute = promisify(execFile);

describe('squash helper on the installed VS Code runtime', () => {
  let privateRoot: string;
  let runtime: SquashRuntime;
  let fixture: Fixture;

  before(async () => {
    assert.ok(
      process.versions.electron,
      'must exercise VS Code Electron, not a development Node executable',
    );
    const extension = vscode.extensions.all.find(
      (candidate) => candidate.packageJSON.name === 'git-ui-native',
    );

    assert.ok(
      extension,
      'Git UI extension must be installed in this test host',
    );
    const packagedHelper = join(
      extension.extensionPath,
      'dist',
      'squash-helper.cjs',
    );

    await access(packagedHelper);
    privateRoot = await mkdtemp(
      join(tmpdir(), "git-native-ui native helper ' ü "),
    );
    const helperDirectory = join(privateRoot, "helper ' ü $() &");

    await mkdir(helperDirectory);
    const helperPath = join(helperDirectory, 'squash-helper.cjs');

    await copyFile(packagedHelper, helperPath);
    runtime = { executable: process.execPath, helperPath };
    fixture = await createFixture({
      prefix: 'git-native-ui squash runtime ü ',
    });
  });
  after(async () => {
    await fixture?.dispose();
    if (privateRoot) await rm(privateRoot, { recursive: true, force: true });
  });

  it('probes the packaged asset with only VS Code’s bundled executable', async () => {
    const electronMode = process.env.ELECTRON_RUN_AS_NODE;

    await probeSquashRuntime(runtime);
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, electronMode);
    const result = await execute(
      runtime.executable,
      [runtime.helperPath, 'probe'],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    );

    assert.equal(result.stdout, 'git-native-ui-squash-helper\n');
  });

  it('Git launches the quoted sequence editor and preserves the literal approved message', async () => {
    const base = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

    await fixture.runGit(['commit', '--allow-empty', '-m', 'First selected']);
    const first = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

    await fixture.runGit(['commit', '--allow-empty', '-m', 'Second selected']);
    const second = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
    const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
    const sentinel = join(privateRoot, 'literal-must-not-execute');
    const message = `Approved native ü\n\n$(touch '${sentinel}') "quoted" 'single'\n`;
    const messagePath = join(privateRoot, "message ' ü.txt");

    await writeFile(messagePath, message);
    const messageCommitSha = (
      await fixture.runGit([
        '-c',
        'commit.gpgSign=false',
        'commit-tree',
        `${base}^{tree}`,
        '-p',
        base,
        '-F',
        messagePath,
      ])
    ).trim();
    const input: SquashEditorInput = {
      operation: 'squash',
      oldestToNewest: [first, second],
      replayShas: [first, second],
      messageCommitSha,
      message,
    };
    const inputPath = join(privateRoot, "approved ' ü.json");

    await writeFile(inputPath, JSON.stringify(input));
    const editors = createSquashEditors(runtime, inputPath);
    const git = (await getGitApi()).api.git.path;

    if (process.platform === 'win32') {
      assert.ok(
        !editors.GIT_EDITOR.includes('\\'),
        'Git for Windows shell paths must use forward slashes',
      );
    }

    await execute(
      git,
      [
        '-c',
        'core.abbrev=64',
        '-c',
        'core.commentChar=#',
        '-c',
        'commit.cleanup=verbatim',
        '-c',
        'rebase.instructionFormat=%s',
        '-c',
        'rebase.abbreviateCommands=false',
        'rebase',
        '--interactive',
        '--force-rebase',
        '--no-autosquash',
        '--no-autostash',
        '--no-fork-point',
        '--no-rebase-merges',
        '--no-update-refs',
        '--keep-empty',
        '--empty=keep',
        '--reapply-cherry-picks',
        base,
      ],
      {
        cwd: fixture.root,
        env: {
          ...process.env,
          ...editors,
          GIT_CONFIG_GLOBAL: join(fixture.root, 'isolated-gitconfig'),
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_TERMINAL_PROMPT: '0',
          GIT_AUTHOR_NAME: 'Fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.test',
          GIT_COMMITTER_NAME: 'Fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.test',
        },
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );

    const commit = await fixture.runGit(['cat-file', 'commit', 'HEAD']);

    assert.equal(commit.slice(commit.indexOf('\n\n') + 2), message);
    assert.equal(
      (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim(),
      tree,
    );
    assert.equal((await fixture.runGit(['rev-parse', 'HEAD^'])).trim(), base);
    assert.equal(
      (await fixture.runGit(['rev-list', '--count', `${base}..HEAD`])).trim(),
      '1',
    );
    assert.equal(await fixture.runGit(['status', '--porcelain=v1']), '');
    await assert.rejects(() => stat(sentinel), { code: 'ENOENT' });
  });

  it('the packaged helper refuses executable todo commands without altering the file', async () => {
    const first = 'a'.repeat(40);
    const second = 'b'.repeat(40);
    const sentinel = join(privateRoot, 'todo-must-not-execute');
    const inputPath = join(privateRoot, 'rejected-input.json');
    const targetPath = join(privateRoot, 'rejected-todo');
    const todo = `pick ${first} first\npick ${second} second\nexec touch '${sentinel}'\n`;

    await writeFile(
      inputPath,
      JSON.stringify({
        operation: 'squash',
        oldestToNewest: [first, second],
        replayShas: [first, second],
        messageCommitSha: 'c'.repeat(40),
        message: 'Approved',
      }),
    );
    await writeFile(targetPath, todo);
    await assert.rejects(() =>
      execute(
        runtime.executable,
        [runtime.helperPath, 'sequence', inputPath, targetPath],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
      ),
    );
    assert.equal(await readFile(targetPath, 'utf8'), todo);
    await assert.rejects(() => stat(sentinel), { code: 'ENOENT' });
  });
});
