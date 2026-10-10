import assert from 'node:assert/strict';

import { expect } from '@playwright/test';
import * as vscode from 'vscode';

import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import { PanelController } from '../../src/extension/panel/controller';
import type { PanelBody, RequestBody, Result } from '../../src/shared/messages';
import { createFixture } from '../fixtures/repository';

describe('native lifecycle', () => {
  it('external ref movement preserves valid selection and restoration but clears excluded objects', async () => {
    const f = await createFixture({ prefix: 'git-ui-native lifecycle ' });
    let controller: PanelController | null = null;

    try {
      const sha = (await f.runGit(['rev-parse', 'HEAD'])).trim();
      const tree = (await f.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
      const access = await getGitApi();

      await access.api.openRepository(vscode.Uri.file(f.root));
      const id = vscode.Uri.file(f.root).toString();

      await access.repository(id).status();
      await expect
        .poll(() => access.repository(id).state.HEAD?.commit)
        .toBe(sha);
      const sent: Result<PanelBody>[] = [];

      controller = new PanelController({
        adapter: await createGitAdapter(),
        trusted: () => true,
        send: (m) => {
          sent.push(m);
        },
        openChange: async () => {},
        pickRepository: async () => null,
        initialRepositoryId: id,
      });
      await controller.selectRepository(id);
      const request = async (body: RequestBody) =>
        controller!.handle({
          requestId: 'lifecycle',
          repositoryId: id,
          generation: Math.max(...sent.map((m) => m.generation)),
          body,
        });

      await request({ kind: 'select-commit', sha });
      const files = sent.filter((m) => m.body.kind === 'files').at(-1)?.body;

      assert.ok(files?.kind === 'files');
      const file = files.files.find((file) => file.newPath === 'sample.txt');

      assert.ok(file);
      await request({ kind: 'open-file', fileId: file.id, preview: true });
      await request({ kind: 'anchor', anchor: { sha, offset: 5 } });
      const advance = (
        await f.runGit(['commit-tree', tree, '-p', sha, '-m', 'Advance'])
      ).trim();

      await f.runGit(['update-ref', 'refs/heads/main', advance]);
      await access.repository(id).status();
      await controller.refresh();
      await expect
        .poll(() => {
          const history = sent
            .filter((message) => message.body.kind === 'history')
            .at(-1)?.body;

          return history?.kind === 'history'
            ? history.page.commits[0]?.sha
            : undefined;
        })
        .toBe(advance);
      let selected = sent
        .filter((m) => m.body.kind === 'selection')
        .at(-1)?.body;

      assert.ok(selected?.kind === 'selection');
      assert.equal(selected.sha, sha);
      assert.equal(selected.filePath, 'sample.txt');
      assert.deepEqual(selected.anchor, { sha, offset: 5 });
      await request({
        kind: 'restore',
        scope: { kind: 'head' },
        text: '',
        selection: { sha, parentSha: null, filePath: 'sample.txt' },
        anchor: { sha, offset: 5 },
      });
      selected = sent.filter((m) => m.body.kind === 'selection').at(-1)?.body;
      assert.ok(selected?.kind === 'selection');
      assert.equal(selected.sha, sha);
      const excluded = (
        await f.runGit(['commit-tree', tree, '-m', 'Unrelated root'])
      ).trim();

      await f.runGit(['update-ref', 'refs/heads/main', excluded]);
      await access.repository(id).status();
      await controller.refresh();
      // A live reference observation can supersede this explicit refresh.
      // Verify the eventual published selection from the newest snapshot.
      await expect
        .poll(() => {
          const current = sent
            .filter((message) => message.body.kind === 'selection')
            .at(-1)?.body;

          return current?.kind === 'selection' ? current.sha : undefined;
        })
        .toBeNull();
      selected = sent.filter((m) => m.body.kind === 'selection').at(-1)?.body;
      assert.ok(selected?.kind === 'selection');
      assert.equal(selected.sha, null);
      assert.equal((await access.repository(id).getCommit(sha)).hash, sha);
    } finally {
      controller?.dispose();
      await f.dispose();
    }
  });
});
