import { assert, expect, test } from 'vitest';

import { offerBranchRestore } from '../../src/extension/panel/actions';
import { fixture } from '../fixtures/controller';

test('a partially deleted group offers one Restore with the failed outcome and original repository', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  let restore: (() => Promise<void>) | undefined;
  let notice: unknown;
  const message = 'Deleted 2 branches. Could not delete: "unmerged".';

  offerBranchRestore(
    {
      kind: 'error',
      backend: 'api',
      message,
      branchRestore: {
        name: 'alpha',
        names: ['alpha', 'beta'],
        token: 'group-token',
      },
    },
    'one',
    {
      adapter: f.adapter,
      trusted: () => true,
      current: () => false,
      refresh: async () => {},
      reportBranchDeleted: (name, action, names, error) => {
        restore = action;
        notice = { name, names, error };
      },
    },
  );
  assert.ok(restore);
  expect(notice).toStrictEqual({
    name: 'alpha',
    names: ['alpha', 'beta'],
    error: message,
  });
  await restore();
  expect(f.writes).toStrictEqual([
    { id: 'one', action: { kind: 'restore-branch', token: 'group-token' } },
  ]);
  f.controller.dispose();
});
for (const trusted of [true, false]) {
  test(`Restore notification uses its captured repository and checks trust=${trusted}`, async (t) => {
    const f = fixture();

    t.onTestFinished(() => f.controller.dispose());
    let action: (() => Promise<void>) | undefined;
    const messages: string[] = [];
    let refreshed = false;

    offerBranchRestore(
      {
        kind: 'success',
        backend: 'api',
        branchRestore: { name: 'topic', token: 'owned-deletion' },
      },
      'one',
      {
        adapter: f.adapter,
        trusted: () => trusted,
        current: () => false,
        refresh: async () => {
          refreshed = true;
        },
        reportActionError: async (message) => {
          messages.push(message);
        },
        reportBranchDeleted: (name, restore) => {
          expect(name).toBe('topic');
          action = restore;
        },
      },
    );
    assert.ok(action);
    await action();
    expect(f.writes).toStrictEqual(
      trusted
        ? [
            {
              id: 'one',
              action: { kind: 'restore-branch', token: 'owned-deletion' },
            },
          ]
        : [],
    );
    expect(refreshed).toBe(false);
    if (!trusted) expect(messages[0]!).toMatch(/Trust this workspace/);
    f.controller.dispose();
  });
}
