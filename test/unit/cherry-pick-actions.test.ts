import { assert, expect, test } from 'vitest';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { PanelActions } from '../../src/extension/panel/actions';
import { commitMenuRequest } from '../../src/extension/panel/protocol';
import { QuerySession } from '../../src/extension/panel/queries';

const a = 'a'.repeat(40);

const b = 'b'.repeat(40);

const head = 'c'.repeat(40);

test('native cherry-pick range uses the whole owned selection in reversed history order', async (t) => {
  const session = new QuerySession();

  t.onTestFinished(() => session.dispose());
  session.begin('repo', 1);
  session.repositoryInfo = {
    id: 'repo',
    label: 'Repo',
    rootUri: 'file:///repo',
    branch: 'main',
    headSha: head,
  };
  for (const sha of [b, a])
    session.commits.set(sha, {
      sha,
      parents: [head],
      message: 'Change',
      authorName: null,
      authorEmail: null,
      authorDate: null,
      commitDate: null,
    });
  session.historyShas = [b, a];
  session.selectRange([b, a], b);
  const request = commitMenuRequest('cherry-pick', {
    gitNativeUIRepositoryId: 'repo',
    gitNativeUIGeneration: 1,
    gitNativeUICommitSha: b,
    gitNativeUICommitShas: [b, a],
    gitNativeUICommitSelectionCount: 2,
  });

  assert.ok(request?.body.kind === 'action');
  const actions = new PanelActions({} as GitAdapter, session, {});
  const reviewed = await actions.review(request.body.action, request);

  expect(reviewed.action).toStrictEqual({
    kind: 'cherry-pick-commits',
    target: { shas: [a, b], expectedHeadSha: head, expectedBranch: 'main' },
  });
  session.select(a);
  expect(reviewed.context?.aborted).toBe(true);
});
