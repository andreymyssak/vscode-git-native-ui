import { assert, expect, test } from 'vitest';

import {
  parseRequest,
  worktreeMenuRequest,
} from '../../src/extension/panel/protocol';
import { fixture } from '../fixtures/controller';

test('worktree deletion accepts only distinct target IDs, never paths or force', () => {
  const request = {
    requestId: 'delete',
    repositoryId: 'one',
    generation: 1,
    body: {
      kind: 'action',
      action: { kind: 'delete-worktrees', worktreeIds: ['a', 'b'] },
    },
  };

  assert.ok(parseRequest(request));
  for (const worktreeIds of [[], ['a', 'a'], Array(401).fill('a'), ['a\0']])
    expect(
      parseRequest({
        ...request,
        body: {
          kind: 'action',
          action: { ...request.body.action, worktreeIds },
        },
      }),
    ).toBe(null);
  for (const extra of [{ path: '/tmp/foreign' }, { force: true }])
    expect(
      parseRequest({
        ...request,
        body: { kind: 'action', action: { ...request.body.action, ...extra } },
      }),
    ).toBe(null);
});
test('the controller rejects unknown worktree targets before confirming or writing', async (t) => {
  let confirmations = 0;
  const f = fixture(true, true, {
    confirmWorktreeDeletion: async () => {
      confirmations++;

      return true;
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.handle(
    f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
  );
  await f.controller.handle(
    f.request({
      kind: 'action',
      action: { kind: 'delete-worktrees', worktreeIds: ['foreign'] },
    }),
  );
  expect(confirmations).toBe(0);
  expect(f.writes.length).toBe(0);
  assert.ok(f.sent.some(({ body }) => body.kind === 'error'));
  f.controller.dispose();
});
test('native worktree menus bind the active row, group count and repository generation', () => {
  const context = {
    gitNativeUIRepositoryId: 'one',
    gitNativeUIGeneration: 1,
    gitNativeUIWorktreeId: 'a',
    gitNativeUIWorktreeIds: ['a', 'b'],
    gitNativeUIWorktreeSelectionCount: 2,
  };

  expect(worktreeMenuRequest('delete-worktrees', context)?.body).toStrictEqual({
    kind: 'action',
    action: { kind: 'delete-worktrees', worktreeIds: ['a', 'b'] },
  });
  expect(worktreeMenuRequest('open-worktree-new', context)).toBe(null);
  for (const altered of [
    { gitNativeUIWorktreeId: 'foreign' },
    { gitNativeUIWorktreeSelectionCount: 1 },
    { gitNativeUIGeneration: -1 },
    { gitNativeUIWorktreeIds: ['a', 'a'] },
  ])
    expect(
      worktreeMenuRequest('delete-worktrees', { ...context, ...altered }),
    ).toBe(null);
  expect(
    worktreeMenuRequest('open-worktree-current', {
      ...context,
      gitNativeUIWorktreeIds: ['a'],
      gitNativeUIWorktreeSelectionCount: 1,
    })?.body,
  ).toStrictEqual({ kind: 'open-worktree', worktreeId: 'a', newWindow: false });
});
for (const cancelled of [true, false])
  test(`worktree confirmation ${cancelled ? 'Cancel' : 'repository switch'} prevents any deletion`, async (t) => {
    let answer!: (value: boolean) => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = fixture(true, true, {
      pickRepository: async () => 'two',
      confirmWorktreeDeletion: () =>
        new Promise((resolve) => {
          answer = resolve;
          entered();
        }),
    });

    t.onTestFinished(() => f.controller.dispose());
    f.adapter.worktrees = async () => [
      {
        id: 'linked',
        name: 'Linked',
        rootUri: 'file:///fixture/linked',
        branch: 'topic',
        current: false,
        main: false,
        available: true,
      },
    ];
    try {
      await f.controller.handle(
        f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
      );
      await f.controller.handle(f.request({ kind: 'worktrees' }));
      const pending = f.controller.handle(
        f.request({
          kind: 'action',
          action: { kind: 'delete-worktrees', worktreeIds: ['linked'] },
        }),
      );

      await ready;
      t.onTestFinished(async () => {
        answer(false);
        await pending;
      });
      if (!cancelled)
        await f.controller.handle(f.request({ kind: 'choose-repository' }));
      answer(!cancelled);
      await pending;
      expect(f.writes.length).toBe(0);
    } finally {
      f.controller.dispose();
    }
  });
