import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import { createFixture } from '../fixtures/repository';

describe('older history with the installed Git API', () => {
  for (const kind of ['edit', 'squash', 'separated squash'] as const) {
    it(`${kind} retains descendants and selects the rewritten commit through the bundled helper`, async () => {
      const f = await createFixture({
        prefix: 'git-native-ui native older history ',
      });
      let adapter: GitAdapter | undefined;
      let storage: string | undefined;

      try {
        storage = await mkdtemp(
          join(tmpdir(), 'git-native-ui native rewrite '),
        );
        const shas: string[] = [];
        const base = (await f.runGit(['rev-parse', 'HEAD'])).trim();

        for (const name of ['A', 'B', 'C', 'D']) {
          await writeFile(join(f.root, `${name}.txt`), name);
          await f.runGit(['add', '.']);
          await f.runGit(['commit', '-m', name]);
          shas.push((await f.runGit(['rev-parse', 'HEAD'])).trim());
        }

        const tree = (await f.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
        const access = await getGitApi();

        await access.api.openRepository(vscode.Uri.file(f.root));
        const id = vscode.Uri.file(f.root).toString();

        await access.repository(id).status();
        const extension = vscode.extensions.all.find(
          (entry) => entry.packageJSON.name === 'git-ui-native',
        );

        assert.ok(extension);
        adapter = await createGitAdapter(undefined, {
          runtime: {
            executable: process.execPath,
            helperPath: join(extension.extensionPath, 'dist/squash-helper.cjs'),
          },
          storageDirectory: storage,
        });
        const expectedHeadSha = shas[3]!;
        const result = await adapter.operate(
          id,
          kind === 'edit'
            ? {
                kind: 'edit-commit-message',
                sha: shas[1]!,
                expectedBranch: 'main',
                expectedHeadSha,
                message: 'Updated native message',
              }
            : {
                kind: 'squash-commits',
                message: 'Combined native commits',
                target: {
                  expectedBranch: 'main',
                  expectedHeadSha,
                  shas: [shas[0]!, shas[kind === 'squash' ? 1 : 2]!],
                },
              },
        );

        assert.ok(result.kind === 'success', JSON.stringify(result));
        assert.ok(result.replacementSha);
        assert.equal(
          (
            await f.runGit(['show', '-s', '--format=%s', result.replacementSha])
          ).trim(),
          kind === 'edit'
            ? 'Updated native message'
            : 'Combined native commits',
        );
        assert.equal(
          (await f.runGit(['rev-parse', 'HEAD^{tree}'])).trim(),
          tree,
        );
        assert.equal(
          (await f.runGit(['rev-list', '--count', `${base}..HEAD`])).trim(),
          kind === 'edit' ? '4' : '3',
        );
      } finally {
        adapter?.dispose();
        await Promise.all([
          f.dispose(),
          storage ? rm(storage, { recursive: true, force: true }) : undefined,
        ]);
      }
    });
  }
});
