import { assert, expect, test } from 'vitest';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { PanelActions } from '../../src/extension/panel/actions';
import { commitMenuRequest } from '../../src/extension/panel/protocol';
import { QuerySession } from '../../src/extension/panel/queries';

const sha = 'a'.repeat(40);

for (const choice of [
  'apply',
  'cancel',
  'change-selection',
  'failed-preflight',
] as const) {
  test(`Drop ${choice} reviews only the current owned range`, async (t) => {
    const session = new QuerySession();

    t.onTestFinished(() => session.dispose());
    let prompts = 0;

    session.begin('repo', 1);
    session.repositoryInfo = {
      id: 'repo',
      label: 'Repo',
      rootUri: 'file:///repo',
      headSha: sha,
      branch: 'main',
    };
    session.commits.set(sha, {
      sha,
      parents: ['b'.repeat(40)],
      message: 'Change',
      authorName: null,
      authorEmail: null,
      authorDate: null,
      commitDate: null,
    });
    session.select(sha);
    const request = commitMenuRequest('drop-commits', {
      gitNativeUIRepositoryId: 'repo',
      gitNativeUIGeneration: 1,
      gitNativeUICommitSha: sha,
      gitNativeUICommitShas: [sha],
      gitNativeUICommitSelectionCount: 1,
    });

    assert.ok(request?.body.kind === 'action');
    const adapter = {
      prepareDrop: async () => {
        if (choice === 'failed-preflight') throw new Error('Published');
      },
    } as unknown as GitAdapter;
    const actions = new PanelActions(adapter, session, {
      confirmDrop: async (branch, count) => {
        prompts++;
        expect(branch).toBe('main');
        expect(count).toBe(1);
        if (choice === 'change-selection') session.select('b'.repeat(40));

        return choice !== 'cancel';
      },
    });
    const review = () =>
      actions.review(
        request.body.kind === 'action'
          ? request.body.action
          : { kind: 'fetch-all' },
        request,
      );

    if (choice === 'failed-preflight' || choice === 'change-selection')
      await expect(review()).rejects.toThrow(
        choice === 'failed-preflight' ? /Published/ : /changed/,
      );
    else {
      const result = await review();

      expect(result.action).toStrictEqual(
        choice === 'cancel'
          ? null
          : {
              kind: 'drop-commits',
              target: {
                shas: [sha],
                expectedBranch: 'main',
                expectedHeadSha: sha,
              },
            },
      );
    }

    expect(prompts).toBe(choice === 'failed-preflight' ? 0 : 1);
  });
}
