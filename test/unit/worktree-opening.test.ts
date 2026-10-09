import { assert, expect, test } from 'vitest';

import { parseRequest } from '../../src/extension/panel/protocol';
import type { WorktreeInfo } from '../../src/shared/model';
import { fixture } from '../fixtures/controller';

const item: WorktreeInfo = {
  id: 'linked',
  name: 'Linked',
  rootUri: 'file:///fixture/linked',
  branch: 'topic',
  current: false,
  main: false,
  available: true,
};

test('worktree opening requires a target ID and an explicit destination', () => {
  const request = {
    requestId: 'open',
    repositoryId: 'one',
    generation: 1,
    body: { kind: 'open-worktree', worktreeId: 'linked' },
  };

  expect(parseRequest(request)).toBe(null);
  for (const newWindow of [true, false])
    assert.ok(
      parseRequest({ ...request, body: { ...request.body, newWindow } }),
    );
  for (const extra of [
    { newWindow: null },
    { newWindow: 'new' },
    { path: '/foreign' },
    { force: true },
  ])
    expect(
      parseRequest({ ...request, body: { ...request.body, ...extra } }),
    ).toBe(null);
});
for (const newWindow of [true, false])
  test(`direct worktree destination ${newWindow} opens the requested VS Code window`, async (t) => {
    const opened: unknown[] = [];
    const f = fixture(true, true, {
      openWorktree: async (worktree, target) => {
        opened.push({ worktree, target });
      },
    });

    t.onTestFinished(() => f.controller.dispose());
    f.adapter.worktrees = async () => [item];
    try {
      await f.controller.handle(
        f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
      );
      await f.controller.handle(f.request({ kind: 'worktrees' }));
      await f.controller.handle(
        f.request({ kind: 'open-worktree', worktreeId: item.id, newWindow }),
      );
      expect(opened).toStrictEqual([
        { worktree: item, target: newWindow ? 'new' : 'current' },
      ]);
    } finally {
      f.controller.dispose();
    }
  });
for (const change of [
  'repository',
  'generation',
  'disposed',
  'missing',
  'unavailable',
  'current',
  'root',
] as const)
  test(`worktree becoming ${change} during the fresh adapter read prevents opening`, async (t) => {
    let answer!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let pause = false;
    let fresh: WorktreeInfo[] = [item];
    const opened: unknown[] = [];
    const f = fixture(true, true, {
      pickRepository: async () => 'two',
      openWorktree: async (worktree) => {
        opened.push(worktree);
      },
    });

    t.onTestFinished(() => f.controller.dispose());
    f.adapter.worktrees = async () => {
      if (pause) {
        pause = false;
        await new Promise<void>((resolve) => {
          answer = resolve;
          entered();
        });
      }

      return fresh;
    };

    try {
      await f.controller.handle(
        f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
      );
      await f.controller.handle(f.request({ kind: 'worktrees' }));
      pause = true;
      const pending = f.controller.handle(
        f.request({
          kind: 'open-worktree',
          worktreeId: item.id,
          newWindow: true,
        }),
      );

      await ready;
      t.onTestFinished(async () => {
        answer();
        await pending;
      });
      if (change === 'repository')
        await f.controller.handle(f.request({ kind: 'choose-repository' }));
      else if (change === 'generation')
        await f.controller.handle(f.request({ kind: 'refresh' }));
      else if (change === 'disposed') f.controller.dispose();
      else
        fresh =
          change === 'missing'
            ? []
            : [
                {
                  ...item,
                  ...(change === 'unavailable' ? { available: false } : {}),
                  ...(change === 'current' ? { current: true } : {}),
                  ...(change === 'root' ? { rootUri: 'file:///foreign' } : {}),
                },
              ];
      answer();
      await pending;
      expect(opened).toStrictEqual([]);
    } finally {
      f.controller.dispose();
    }
  });
test('current and unknown worktrees never open a window', async (t) => {
  const opened: unknown[] = [];
  const f = fixture(true, true, {
    openWorktree: async (worktree) => {
      opened.push(worktree);
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  f.adapter.worktrees = async () => [{ ...item, current: true }];
  try {
    await f.controller.handle(
      f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
    );
    await f.controller.handle(f.request({ kind: 'worktrees' }));
    for (const worktreeId of [item.id, 'foreign'])
      await f.controller.handle(
        f.request({ kind: 'open-worktree', worktreeId, newWindow: true }),
      );
    expect(opened).toStrictEqual([]);
    expect(f.sent.filter(({ body }) => body.kind === 'error').length).toBe(2);
  } finally {
    f.controller.dispose();
  }
});
