import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import { changeUris, openChange } from '../../src/extension/native/editors';
import { createFixture } from '../fixtures/repository';

async function expectNativeDiff(
  uris: { original: vscode.Uri; modified: vscode.Uri },
  preview: boolean,
): Promise<void> {
  await expect
    .poll(() => {
      const tab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find(
          (candidate) =>
            candidate.isActive &&
            candidate.input instanceof vscode.TabInputTextDiff,
        );
      const input = tab?.input;

      return input instanceof vscode.TabInputTextDiff
        ? {
            original: input.original.toString(),
            modified: input.modified.toString(),
            preview: tab?.isPreview,
          }
        : null;
    })
    .toEqual({
      original: uris.original.toString(),
      modified: uris.modified.toString(),
      preview,
    });
}

describe('historical changes', () => {
  it('ordinary file compares exact parent; root, deleted and rename retain paths', async () => {
    const fixture = await createFixture({ prefix: 'git-native-ui diffs ü ' });
    let adapter: GitAdapter | undefined;

    try {
      adapter = await createGitAdapter();

      await (
        await getGitApi()
      ).api.openRepository(vscode.Uri.file(fixture.root));
      const id = vscode.Uri.file(fixture.root).toString();

      await vscode.extensions
        .getExtension('local-git-native-ui.git-native-ui')!
        .activate();
      const access = await getGitApi();
      const parent = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const root = await adapter.changes(id, parent, null);
      const rootFile = root.find((f) => f.newPath === 'sample.txt');

      assert.ok(rootFile);
      assert.equal(rootFile.oldPath, null);
      const rootHandle = { sha: parent, parentSha: null, file: rootFile };
      const rootUris = changeUris(access, id, rootHandle);

      assert.equal(
        (await vscode.workspace.openTextDocument(rootUris.original)).getText(),
        '',
      );
      assert.equal(
        (await vscode.workspace.openTextDocument(rootUris.modified)).getText(),
        'first\n',
      );
      await openChange(access, id, rootHandle, true);
      await expectNativeDiff(rootUris, true);
      await fixture.runGit(['mv', 'sample.txt', 'renamed ü file.txt']);
      await fixture.runGit(['commit', '-m', 'Rename']);
      const renamed = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const rename = (await adapter.changes(id, renamed, parent)).find(
        (f) => f.status === 'renamed',
      );

      assert.equal(rename?.oldPath, 'sample.txt');
      assert.equal(rename.newPath, 'renamed ü file.txt');
      const renameHandle = { sha: renamed, parentSha: parent, file: rename };
      const renameUris = changeUris(access, id, renameHandle);

      assert.equal(
        (
          await vscode.workspace.openTextDocument(renameUris.original)
        ).getText(),
        'first\n',
      );
      assert.equal(
        (
          await vscode.workspace.openTextDocument(renameUris.modified)
        ).getText(),
        'first\n',
      );
      await openChange(access, id, renameHandle, false);
      await expectNativeDiff(renameUris, false);
      await mkdir(join(fixture.root, 'folder'));
      await writeFile(join(fixture.root, 'folder', 'added.txt'), 'added\n');
      await writeFile(
        join(fixture.root, 'binary.bin'),
        new Uint8Array([0, 1, 2, 3]),
      );
      await writeFile(join(fixture.root, 'renamed ü file.txt'), 'changed\n');
      await fixture.runGit(['add', '.']);
      await fixture.runGit(['commit', '-m', 'Files']);
      const changed = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const changes = await adapter.changes(id, changed, renamed);

      assert.equal(
        changes.find((f) => f.newPath === 'renamed ü file.txt')?.status,
        'modified',
      );
      assert.equal(
        changes.find((f) => f.newPath === 'binary.bin')?.status,
        'added',
      );
      const modification = changes.find((file) => file.status === 'modified');

      assert.ok(modification);
      const modifiedHandle = {
        sha: changed,
        parentSha: renamed,
        file: modification,
      };

      await openChange(access, id, modifiedHandle, true);
      await expectNativeDiff(changeUris(access, id, modifiedHandle), true);

      await rm(join(fixture.root, 'renamed ü file.txt'));
      await fixture.runGit(['add', '.']);
      await fixture.runGit(['commit', '-m', 'Deleted']);
      const deleted = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
      const deletion = (await adapter.changes(id, deleted, changed)).find(
        (f) => f.oldPath === 'renamed ü file.txt',
      );

      assert.ok(deletion);
      assert.equal(deletion.newPath, null);
      const deletedHandle = {
        sha: deleted,
        parentSha: changed,
        file: deletion,
      };
      const deletedUris = changeUris(access, id, deletedHandle);

      assert.equal(
        (
          await vscode.workspace.openTextDocument(deletedUris.original)
        ).getText(),
        'changed\n',
      );
      assert.equal(
        (
          await vscode.workspace.openTextDocument(deletedUris.modified)
        ).getText(),
        '',
      );
      await openChange(access, id, deletedHandle, true);
      await expectNativeDiff(deletedUris, true);
      const binary = changes.find((f) => f.newPath === 'binary.bin');

      assert.ok(binary);
      await openChange(
        access,
        id,
        { sha: changed, parentSha: renamed, file: binary },
        true,
      );
      const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
      const second = (
        await fixture.runGit([
          'commit-tree',
          tree,
          '-p',
          parent,
          '-m',
          'Second',
        ])
      ).trim();
      const third = (
        await fixture.runGit(['commit-tree', tree, '-p', parent, '-m', 'Third'])
      ).trim();
      const octopus = (
        await fixture.runGit([
          'commit-tree',
          tree,
          '-p',
          deleted,
          '-p',
          second,
          '-p',
          third,
          '-m',
          'Octopus',
        ])
      ).trim();

      for (const p of [deleted, second, third])
        await adapter.changes(id, octopus, p);

      const missing = (
        await fixture.runGit([
          'commit-tree',
          tree,
          '-p',
          parent,
          '-m',
          'Missing parent',
        ])
      ).trim();
      const shallow = (
        await fixture.runGit([
          'commit-tree',
          tree,
          '-p',
          missing,
          '-m',
          'Shallow child',
        ])
      ).trim();

      await rm(
        join(
          fixture.root,
          '.git',
          'objects',
          missing.slice(0, 2),
          missing.slice(2),
        ),
      );
      await assert.rejects(
        () => adapter!.changes(id, shallow, missing),
        /parent object is unavailable/,
      );
      const windowsRoot = vscode.Uri.from({
        scheme: 'file',
        path: '/C:/Fixture With Space',
      });
      const windowsAccess = {
        ...access,
        repository: () => ({ ...access.repository(id), rootUri: windowsRoot }),
      };
      const windowsUris = changeUris(windowsAccess, id, {
        sha: renamed,
        parentSha: parent,
        file: {
          id: 'windows',
          status: 'renamed',
          oldPath: 'old ü.txt',
          newPath: 'folder/new ü.txt',
        },
      });

      assert.equal(
        windowsUris.original.query,
        access.api.toGitUri(
          vscode.Uri.joinPath(windowsRoot, 'old ü.txt'),
          parent,
        ).query,
      );
      assert.equal(
        windowsUris.modified.query,
        access.api.toGitUri(
          vscode.Uri.joinPath(windowsRoot, 'folder', 'new ü.txt'),
          renamed,
        ).query,
      );
      await assert.rejects(
        () => adapter!.changes(id, changed, 'f'.repeat(40)),
        /parent|comparison/i,
      );
    } finally {
      adapter?.dispose();
      try {
        await vscode.commands.executeCommand(
          'workbench.action.closeAllEditors',
        );
      } finally {
        await fixture.dispose();
      }
    }
  });
});

describe('genuine shallow boundaries', () => {
  it('retains actual parents for shallow commit and merge without a root diff', async () => {
    for (const merge of [false, true]) {
      const fixture = await createFixture({
        prefix: 'git-native-ui shallow source ',
      });
      let adapter: GitAdapter | undefined;

      try {
        adapter = await createGitAdapter();

        const base = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

        await writeFile(join(fixture.root, 'sample.txt'), 'second\n');
        await fixture.runGit(['add', 'sample.txt']);
        await fixture.runGit(['commit', '-m', 'Child']);
        let head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
        let parents = [base];

        if (merge) {
          const tree = (
            await fixture.runGit(['rev-parse', 'HEAD^{tree}'])
          ).trim();
          const side = (
            await fixture.runGit([
              'commit-tree',
              tree,
              '-p',
              base,
              '-m',
              'Side',
            ])
          ).trim();

          parents = [head, side];
          head = (
            await fixture.runGit([
              'commit-tree',
              tree,
              '-p',
              head,
              '-p',
              side,
              '-m',
              'Boundary merge',
            ])
          ).trim();
          await fixture.runGit(['update-ref', 'refs/heads/main', head]);
        }

        const clone = join(fixture.root, 'shallow clone');

        await fixture.runGit([
          'clone',
          '--depth=1',
          vscode.Uri.file(fixture.root).toString(),
          clone,
        ]);
        const access = await getGitApi();
        const repo = await access.api.openRepository(vscode.Uri.file(clone));

        assert.ok(repo);
        assert.deepEqual(
          (await repo.getCommit(head)).parents,
          [],
          'native successful log hides boundary parents',
        );
        const id = vscode.Uri.file(clone).toString();
        const page = await adapter.history(id, {
          scope: { kind: 'head' },
          text: '',
          cursor: null,
        });

        assert.deepEqual(page.commits[0]?.parents, parents);
        const resolved = await adapter.resolve(id, head);

        assert.equal(resolved.kind, 'commit');
        if (resolved.kind === 'commit')
          assert.deepEqual(resolved.commit.parents, parents);
        await assert.rejects(
          () => adapter!.changes(id, head, null),
          /actual parent/,
        );
        for (const parent of parents)
          await assert.rejects(
            () => adapter!.changes(id, head, parent),
            /parent object is unavailable/,
          );
        assert.equal((await repo.getCommit('HEAD')).hash, head);
      } finally {
        adapter?.dispose();
        await fixture.dispose();
      }
    }
  });
});
