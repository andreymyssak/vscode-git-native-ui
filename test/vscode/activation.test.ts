import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import { GitCli } from '../../src/extension/git/cli';
import { nativeBrowser } from '../fixtures/native-panel';
import type { Fixture } from '../fixtures/repository';
import { createFixture } from '../fixtures/repository';

describe('native capabilities', () => {
  const roots: Fixture[] = [];

  before(async () => {
    for (const name of ['one', 'two'])
      roots.push(await createFixture({ prefix: `git-native-ui ${name} ` }));
    const access = await getGitApi();

    for (const root of roots)
      await access.api.openRepository(vscode.Uri.file(root.root));
    const extension = vscode.extensions.getExtension(
      'local-git-native-ui.git-native-ui',
    );

    assert.ok(extension);
    await extension.activate();
  });
  after(async () => {
    await Promise.all(roots.map((root) => root.dispose()));
  });
  it('installed API opens selected repository', async () => {
    const adapter = await createGitAdapter();

    try {
      assert.equal(adapter.repositories().length, 2);
      assert.deepEqual(
        adapter
          .repositories()
          .map((repo) => vscode.Uri.parse(repo.rootUri).fsPath)
          .sort(),
        roots.map((root) => root.root).sort(),
      );
    } finally {
      adapter.dispose();
    }
  });
  it('the supported VS Code runtime opens the native panel', async () => {
    const [major, minor] = vscode.version.split('.').map(Number);

    assert.ok(major! > 1 || (major === 1 && minor! >= 140));
    await vscode.commands.executeCommand('gitNativeUI.log.focus');
    const browser = await nativeBrowser();
    const workbench = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().includes('/workbench/workbench.html'));

    assert.ok(workbench);
    await expect(
      workbench.getByRole('tab', { name: 'Git Native UI', exact: true }),
    ).toBeVisible();
  });
  it('native diff uses revision URIs', async () => {
    const root = roots[0];

    assert.ok(root);
    const access = await getGitApi();
    const parent = (await root.runGit(['rev-parse', 'HEAD'])).trim();

    await writeFile(join(root.root, 'sample.txt'), 'second\n');
    await root.runGit(['add', 'sample.txt']);
    await root.runGit(['commit', '-m', 'Modified']);
    const head = (await root.runGit(['rev-parse', 'HEAD'])).trim();
    const originalUri = access.api.toGitUri(
      vscode.Uri.file(join(root.root, 'sample.txt')),
      parent,
    );
    const modifiedUri = access.api.toGitUri(
      vscode.Uri.file(join(root.root, 'sample.txt')),
      head,
    );

    assert.equal(originalUri.scheme, 'git');
    assert.equal(
      (await vscode.workspace.openTextDocument(originalUri)).getText(),
      'first\n',
    );
    assert.equal(
      (await vscode.workspace.openTextDocument(modifiedUri)).getText(),
      'second\n',
    );
    try {
      await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        modifiedUri,
        'Fixture comparison',
        { preview: true },
      );
      const commands = await vscode.commands.getCommands(true);

      await mkdir(join(process.cwd(), '.artifacts'), { recursive: true });
      await writeFile(
        join(process.cwd(), '.artifacts/native-runtime.json'),
        JSON.stringify(
          {
            vscode: vscode.version,
            node: process.versions.node,
            electron: process.versions.electron,
            git: access.api.git.path,
            gitVersion: (
              await new GitCli(access).run(
                vscode.Uri.file(root.root).toString(),
                ['--version'],
              )
            ).trim(),
            os: process.platform,
            arch: process.arch,
            cherryPickCommands: commands.filter((id) =>
              id.includes('cherryPick'),
            ),
          },
          null,
          2,
        ),
      );
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });
});
