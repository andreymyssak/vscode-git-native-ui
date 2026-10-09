import { assert, expect, test } from 'vitest';

import {
  branchMenuRequest,
  parseRequest,
} from '../../src/extension/panel/protocol';

test('batch deletion accepts distinct branch IDs and rejects supplied write targets or invalid ranges', () => {
  const action = {
    kind: 'delete-branches',
    refIds: ['refs/heads/alpha', 'refs/heads/beta'],
  };
  const request = {
    requestId: 'delete-many',
    repositoryId: 'one',
    generation: 1,
    body: { kind: 'action', action },
  };

  expect(parseRequest(request)?.body).toStrictEqual(request.body);
  for (const refIds of [
    [],
    ['refs/heads/alpha'],
    ['refs/heads/alpha', 'refs/heads/alpha'],
    ['refs/heads/', 'refs/heads/beta'],
    ['refs/remotes/origin/main', 'refs/heads/beta'],
    ['refs/heads/a\u0000', 'refs/heads/beta'],
    Array.from({ length: 401 }, (_, i) => `refs/heads/${i}`),
  ])
    expect(
      parseRequest({
        ...request,
        body: { kind: 'action', action: { ...action, refIds } },
      }),
    ).toBe(null);
  expect(
    parseRequest({
      ...request,
      body: {
        kind: 'action',
        action: { ...action, expectedSha: 'f'.repeat(40) },
      },
    }),
  ).toBe(null);
});
test('a multi-branch context cannot run a single-branch command', () => {
  const context = {
    gitNativeUIRepositoryId: 'one',
    gitNativeUIGeneration: 1,
    gitNativeUIRefId: 'refs/heads/alpha',
    gitNativeUIRefSelectionCount: 2,
    gitNativeUIRefIds: ['refs/heads/alpha', 'refs/heads/beta'],
  };

  expect(branchMenuRequest('checkout', context)).toBe(null);
  expect(branchMenuRequest('delete-branch', context)).toBe(null);
});
test('native batch request requires matching count and active membership', () => {
  const context = {
    gitNativeUIRepositoryId: 'one',
    gitNativeUIGeneration: 1,
    gitNativeUIRefId: 'refs/heads/alpha',
    gitNativeUIRefSelectionCount: 2,
    gitNativeUIRefIds: ['refs/heads/alpha', 'refs/heads/beta'],
  };

  expect(branchMenuRequest('delete-branches', context)?.body).toStrictEqual({
    kind: 'action',
    action: { kind: 'delete-branches', refIds: context.gitNativeUIRefIds },
  });
  for (const override of [
    { gitNativeUIRefSelectionCount: 3 },
    { gitNativeUIRefId: 'refs/heads/other' },
    { gitNativeUIRefIds: ['refs/heads/alpha', 'refs/heads/alpha'] },
  ])
    expect(
      branchMenuRequest('delete-branches', { ...context, ...override }),
    ).toBe(null);
  const refIds = Array.from({ length: 400 }, (_, i) => `refs/heads/${i}`);

  assert.ok(
    branchMenuRequest('delete-branches', {
      ...context,
      gitNativeUIRefId: refIds[0],
      gitNativeUIRefSelectionCount: refIds.length,
      gitNativeUIRefIds: refIds,
    }),
  );
});
