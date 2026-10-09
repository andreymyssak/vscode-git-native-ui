import { expect, test } from 'vitest';

import { parseRequest } from '../../src/extension/panel/protocol';

for (const kind of ['merge-branch', 'rebase-branch', 'create-worktree']) {
  test(`${kind} accepts a reference ID request and rejects supplied write targets`, () => {
    const request = {
      requestId: 'integrate',
      repositoryId: 'repository',
      generation: 4,
      body: { kind: 'action', action: { kind, refId: 'refs/heads/feature' } },
    };

    expect(parseRequest(request)?.body).toStrictEqual(request.body);
    if (kind !== 'create-worktree')
      expect(
        parseRequest({
          ...request,
          body: { kind: 'action', action: { kind } },
        }),
      ).toBe(null);
    expect(
      parseRequest({
        ...request,
        body: {
          kind: 'action',
          action: { ...request.body.action, expectedBranch: 'forged' },
        },
      }),
    ).toBe(null);
  });
}

test('toolbar worktree creation asks for a native branch instead of accepting write parameters', () => {
  const request = {
    requestId: 'create',
    repositoryId: 'repo',
    generation: 1,
    body: { kind: 'action', action: { kind: 'create-worktree' } },
  };

  expect(parseRequest(request)?.body).toStrictEqual(request.body);
  for (const extra of [
    { refId: null },
    { refId: '' },
    { path: '/foreign' },
    { name: 'forged' },
    { sha: 'a'.repeat(40) },
  ])
    expect(
      parseRequest({
        ...request,
        body: { kind: 'action', action: { ...request.body.action, ...extra } },
      }),
    ).toBe(null);
});
