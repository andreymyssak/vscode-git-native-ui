import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import {
  askCommitMessage,
  askSquashMessage,
} from '../../src/extension/native/dialogs';
import type { GitAction } from '../../src/shared/model';
import { nativeBrowser, trackNativeDrafts } from '../fixtures/native-panel';
import { createFixture } from '../fixtures/repository';

describe('native message review and amendment', () => {
  it('squash review names the branch and range in a regular editor and treats cancellation or a closed draft as no Apply', async () => {
    const browser = await nativeBrowser();
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) =>
        candidate.url().includes('/workbench/workbench.html'),
      );

    assert.ok(page);
    const original = 'Oldest full\n\nBody ü\n\nLatest full';
    const prompt = page.getByRole('dialog', {
      name: /^Info: Squash 3 commits on/,
    });
    const drafts = trackNativeDrafts();
    let reviewing = askSquashMessage(original, 'topic/ü', 3);

    void Promise.resolve(reviewing).catch(() => {});

    try {
      await expect
        .poll(() => vscode.window.activeTextEditor?.document.getText())
        .toBe(original);
      const document = vscode.window.activeTextEditor!.document;
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;

      assert.equal(document.languageId, 'plaintext');
      assert.equal(document.uri.scheme, 'untitled');
      assert.equal(tab?.isPreview, false);
      await vscode.commands.executeCommand('notifications.showList');
      await expect(
        prompt.getByText('Squash 3 commits on "topic/ü" into one commit.', {
          exact: false,
        }),
      ).toBeVisible();
      const cancel = prompt.getByRole('button', {
        name: 'Cancel',
        exact: true,
      });

      await expect(cancel).toBeVisible();
      await cancel.evaluate((node) => (node as HTMLElement).click());
      assert.equal(await reviewing, null);
      await expect(cancel).toHaveCount(0);
      reviewing = askSquashMessage(original, 'topic/ü', 3);
      void Promise.resolve(reviewing).catch(() => {});
      await expect
        .poll(() => vscode.window.activeTextEditor?.document.uri.toString())
        .not.toBe(document.uri.toString());
      await expect
        .poll(() => vscode.window.activeTextEditor?.document.getText())
        .toBe(original);
      const closed = vscode.window.activeTextEditor!.document;
      const closingTab = vscode.window.tabGroups.activeTabGroup.activeTab;

      assert.ok(closingTab);
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor',
      );
      await expect.poll(() => closed.isClosed).toBe(true);
      await vscode.commands.executeCommand('notifications.showList');
      const apply = prompt.getByRole('button', { name: 'Apply', exact: true });

      await expect(apply).toBeVisible();
      await apply.evaluate((node) => (node as HTMLElement).click());
      assert.equal(await reviewing, null);
      await expect(apply).toHaveCount(0);
    } finally {
      try {
        const cancel = prompt.getByRole('button', {
          name: 'Cancel',
          exact: true,
        });

        if (await cancel.count())
          await cancel.evaluate((node) => (node as HTMLElement).click());
      } finally {
        try {
          await vscode.commands.executeCommand('notifications.clearAll');
          await Promise.resolve(reviewing).catch(() => {});
        } finally {
          await Promise.all([
            vscode.commands.executeCommand('notifications.hideList'),
            drafts.dispose(),
          ]);
        }
      }
    }
  });
  it('uses a regular native editor and Apply/Cancel notification for the full message', async () => {
    const browser = await nativeBrowser();
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) =>
        candidate.url().includes('/workbench/workbench.html'),
      );

    assert.ok(page, 'the native workbench page must be present');
    const original = 'Original subject\n\nOriginal body.';
    const prompt = page.getByRole('dialog', {
      name: /^Info: Edit the commit message in the editor/,
    });
    const drafts = trackNativeDrafts();
    let draft = askCommitMessage(original);

    void Promise.resolve(draft).catch(() => {});

    try {
      await expect
        .poll(() => vscode.window.activeTextEditor?.document.getText())
        .toBe(original);
      const document = vscode.window.activeTextEditor!.document;

      assert.equal(document.uri.scheme, 'untitled');
      assert.equal(document.languageId, 'plaintext');
      const edited = 'Edited subject\n\nPreserve a multiline body.';
      const change = new vscode.WorkspaceEdit();

      change.replace(
        document.uri,
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(original.length),
        ),
        edited,
      );
      assert.equal(await vscode.workspace.applyEdit(change), true);
      // Native toasts can collapse; the actionable notification persists
      // in the notification center while the draft remains open.
      await vscode.commands.executeCommand('notifications.showList');
      const apply = prompt.getByRole('button', {
        name: 'Apply',
        exact: true,
      });

      await expect(apply).toBeVisible();
      await apply.evaluate((node) => (node as HTMLElement).click());
      assert.equal(await draft, edited);
      // Native notifications finish removing their controls after resolving.
      // Wait for the first prompt to leave before testing a second prompt.
      await expect(apply).toHaveCount(0);
      draft = askCommitMessage(original);
      void Promise.resolve(draft).catch(() => {});
      await expect
        .poll(() => vscode.window.activeTextEditor?.document.uri.toString())
        .not.toBe(document.uri.toString());
      await expect
        .poll(() => vscode.window.activeTextEditor?.document.getText())
        .toBe(original);
      await vscode.commands.executeCommand('notifications.showList');
      const cancel = prompt.getByRole('button', {
        name: 'Cancel',
        exact: true,
      });

      await expect(cancel).toBeVisible();
      await cancel.evaluate((node) => (node as HTMLElement).click());
      assert.equal(await draft, null);
      await expect(cancel).toHaveCount(0);
    } finally {
      try {
        const cancel = prompt.getByRole('button', {
          name: 'Cancel',
          exact: true,
        });

        if (await cancel.count())
          await cancel.evaluate((node) => (node as HTMLElement).click());
      } finally {
        try {
          await vscode.commands.executeCommand('notifications.clearAll');
          await Promise.resolve(draft).catch(() => {});
        } finally {
          await Promise.all([
            vscode.commands.executeCommand('notifications.hideList'),
            drafts.dispose(),
          ]);
        }
      }
    }
  });
  it('rejects untracked changes even when Git status hides them', async () => {
    const fixture = await createFixture({
      prefix: 'git-native-ui hidden changes ',
    });
    let adapter: GitAdapter | undefined;

    try {
      const access = await getGitApi();

      await access.api.openRepository(vscode.Uri.file(fixture.root));
      adapter = await createGitAdapter();
      const id = vscode.Uri.file(fixture.root).toString();

      const head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

      await fixture.runGit(['config', 'status.showUntrackedFiles', 'no']);
      await writeFile(join(fixture.root, 'untracked.txt'), 'Keep this file\n');
      assert.equal(await fixture.runGit(['status', '--porcelain']), '');
      await assert.rejects(
        adapter.prepareMessageEdit(id, head, 'main', head),
        /working changes/,
      );
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
      assert.equal(
        await readFile(join(fixture.root, 'untracked.txt'), 'utf8'),
        'Keep this file\n',
      );
    } finally {
      adapter?.dispose();
      await fixture.dispose();
    }
  });
  it('amends only the message and preserves the tree, author, parent and other refs', async () => {
    const fixture = await createFixture({
      prefix: 'git-native-ui amend message ',
    });
    let adapter: GitAdapter | undefined;

    try {
      const access = await getGitApi();

      await access.api.openRepository(vscode.Uri.file(fixture.root));
      adapter = await createGitAdapter();
      const id = vscode.Uri.file(fixture.root).toString();

      await fixture.runGit(['commit', '--allow-empty', '-m', 'Second']);
      const before = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

      await fixture.runGit(['branch', 'other']);
      await fixture.runGit(['tag', 'old-message']);
      const metadata = await fixture.runGit([
        'show',
        '-s',
        '--format=%T%n%P%n%an%n%ae%n%aI',
        'HEAD',
      ]);
      const result = await adapter.operate(id, {
        kind: 'edit-commit-message',
        expectedHeadSha: before,
        sha: before,
        expectedBranch: 'main',
        message:
          'New subject\n\nA full message body with <markup>, quotes and $() text.',
      } as GitAction);

      assert.equal(result.kind, 'success');
      assert.equal(result.backend, 'cli');
      assert.notEqual(
        (await fixture.runGit(['rev-parse', 'HEAD'])).trim(),
        before,
      );
      assert.equal(
        await fixture.runGit([
          'show',
          '-s',
          '--format=%T%n%P%n%an%n%ae%n%aI',
          'HEAD',
        ]),
        metadata,
      );
      assert.equal(
        (await fixture.runGit(['show', '-s', '--format=%B', 'HEAD'])).trim(),
        'New subject\n\nA full message body with <markup>, quotes and $() text.',
      );
      for (const ref of ['refs/heads/other', 'refs/tags/old-message'])
        assert.equal((await fixture.runGit(['rev-parse', ref])).trim(), before);
      assert.equal(await fixture.runGit(['status', '--porcelain']), '');
      for (const [sha, expectedBranch] of [
        [before, 'main'],
        [(await fixture.runGit(['rev-parse', 'HEAD'])).trim(), 'other'],
      ]) {
        const head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

        assert.equal(
          (
            await adapter.operate(id, {
              kind: 'edit-commit-message',
              expectedHeadSha: head,
              sha,
              expectedBranch,
              message: 'Stale',
            } as GitAction)
          ).kind,
          'error',
        );
        assert.equal(
          (await fixture.runGit(['rev-parse', 'HEAD'])).trim(),
          head,
        );
      }

      const head = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

      await writeFile(join(fixture.root, 'sample.txt'), 'Unstaged\n');
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'edit-commit-message',
            expectedHeadSha: head,
            sha: head,
            expectedBranch: 'main',
            message: 'Dirty',
          } as GitAction)
        ).kind,
        'error',
      );
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
      assert.equal(
        await fixture.runGit(['diff', '--numstat']),
        '1\t1\tsample.txt\n',
      );
      await fixture.runGit(['add', 'sample.txt']);
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'edit-commit-message',
            expectedHeadSha: head,
            sha: head,
            expectedBranch: 'main',
            message: 'Staged changes',
          })
        ).kind,
        'error',
      );
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
      assert.equal(
        await fixture.runGit(['diff', '--cached', '--numstat']),
        '1\t1\tsample.txt\n',
      );
      await fixture.runGit(['restore', '--staged', '--worktree', 'sample.txt']);
      await fixture.runGit(['update-ref', 'refs/remotes/origin/main', head]);
      assert.equal(
        (
          await adapter.operate(id, {
            kind: 'edit-commit-message',
            expectedHeadSha: head,
            sha: head,
            expectedBranch: 'main',
            message: 'Published',
          })
        ).kind,
        'error',
      );
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
      await fixture.runGit(['update-ref', '-d', 'refs/remotes/origin/main']);
      // A newer remote tip still contains HEAD, even when no remote ref equals it.
      await fixture.runGit(['checkout', '-b', 'published']);
      await fixture.runGit([
        'commit',
        '--allow-empty',
        '-m',
        'Remote successor',
      ]);
      const remoteTip = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();

      await fixture.runGit([
        'update-ref',
        'refs/remotes/origin/main',
        remoteTip,
      ]);
      await fixture.runGit(['checkout', 'main']);
      await assert.rejects(
        adapter.prepareMessageEdit(id, head, 'main', head),
        /known remote history/,
      );
      assert.equal((await fixture.runGit(['rev-parse', 'HEAD'])).trim(), head);
    } finally {
      adapter?.dispose();
      await fixture.dispose();
    }
  });
});
