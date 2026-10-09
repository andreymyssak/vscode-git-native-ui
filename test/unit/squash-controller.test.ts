import { assert, expect, test, vi } from 'vitest';

import type { ControllerOptions } from '../../src/extension/panel/controller';
import { a, b, fixture, page } from '../fixtures/controller';

const c = 'c'.repeat(40);
const replacement = 'd'.repeat(40);
const squash = { kind: 'squash-commits' as const, shas: [a, b], activeSha: a };

async function setup(options: Partial<ControllerOptions> = {}) {
  const f = fixture(true, true, options);
  const history = page([a, b, c]);

  history.commits.forEach((commit, index) => {
    commit.parents = [history.commits[index + 1]?.sha ?? 'f'.repeat(40)];
  });
  f.adapter.history = async () => history;
  f.adapter.prepareSquash = async (_id, target) => ({
    ...target,
    replayShas: [...target.shas].reverse(),
    oldestToNewest: [...target.shas].reverse(),
    oldestParentSha: c,
    treeSha: 'e'.repeat(40),
    messages: ['Older full\n\nBody ü', 'Latest full'],
  });
  try {
    await f.controller.selectRepository('one');
    await f.controller.handle(
      f.request({ kind: 'select-commits', shas: [a, b], activeSha: a }),
    );

    return f;
  } catch (error) {
    f.controller.dispose();
    throw error;
  }
}

test('a valid unchanged combined draft submits one reviewed squash and selects the replacement', async (t) => {
  let opened = 0;
  const f = await setup({
    askSquashMessage: async (draft, branch, count) => {
      opened++;
      expect(branch).toBe('main');
      expect(count).toBe(2);
      expect(draft).toBe('Older full\n\nBody ü\n\nLatest full');

      return draft;
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  let writes = 0;

  f.adapter.operate = async (_id, action) => {
    writes++;
    assert.ok(action.kind === 'squash-commits');
    expect(action.target.shas).toStrictEqual([a, b]);
    f.adapter.history = async () => page([replacement, c]);

    return { kind: 'success', backend: 'cli', replacementSha: replacement };
  };

  await f.controller.handle(f.request({ kind: 'action', action: squash }));
  expect(opened).toBe(1);
  expect(writes).toBe(1);
  expect(
    f.sent.some(
      ({ body }) => body.kind === 'selection' && body.sha === replacement,
    ),
  ).toBe(true);
});

test('a rewrite history event waits for the replacement selection before refreshing', async (t) => {
  vi.useFakeTimers();
  t.onTestFinished(() => {
    vi.useRealTimers();
  });
  const f = await setup({ askSquashMessage: async (message) => message });

  t.onTestFinished(() => f.controller.dispose());
  let started!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const write = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let signal: AbortSignal | undefined;

  f.adapter.operate = async (_id, _action, context) => {
    signal = context;
    f.adapter.history = async () => page([replacement, c]);
    f.fireHistoryEvent();
    started();
    await write;

    return { kind: 'success', backend: 'cli', replacementSha: replacement };
  };

  const action = f.controller.handle(
    f.request({ kind: 'action', action: squash }),
  );

  t.onTestFinished(async () => {
    finish();
    await action;
  });
  await ready;
  await vi.advanceTimersByTimeAsync(100);
  const abortedDuringWrite = signal?.aborted;

  finish();
  await action;
  expect(abortedDuringWrite).toBe(false);
  expect(
    f.sent.filter(({ body }) => body.kind === 'selection').at(-1)?.body,
  ).toMatchObject({ kind: 'selection', sha: replacement });
});

test('repository changes during native message review still cancel the write', async (t) => {
  vi.useFakeTimers();
  t.onTestFinished(() => {
    vi.useRealTimers();
  });
  let opened!: () => void;
  let apply!: (message: string) => void;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const draft = new Promise<string>((resolve) => {
    apply = resolve;
  });
  const f = await setup({
    askSquashMessage: async () => {
      opened();

      return draft;
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  const action = f.controller.handle(
    f.request({ kind: 'action', action: squash }),
  );

  t.onTestFinished(async () => {
    apply('Reviewed');
    await action;
  });
  await ready;
  f.fireHistoryEvent();
  await vi.advanceTimersByTimeAsync(100);
  apply('Reviewed');
  await action;
  expect(f.writes).toHaveLength(0);
  expect(f.sent.some(({ body }) => body.kind === 'error')).toBe(true);
});

test(
  'range changes with the same active commit invalidate an open native draft',
  { timeout: 2000 },
  async (t) => {
    let apply!: (message: string) => void;
    let opened!: () => void;
    const ready = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const draft = new Promise<string>((resolve) => {
      apply = resolve;
    });
    const f = await setup({
      askSquashMessage: async () => {
        opened();

        return draft;
      },
    });

    t.onTestFinished(() => f.controller.dispose());
    const action = f.controller.handle(
      f.request({ kind: 'action', action: squash }),
    );

    t.onTestFinished(async () => {
      apply('Reviewed');
      await action;
    });
    await ready;
    await f.controller.handle(
      f.request({ kind: 'select-commits', shas: [a, b, c], activeSha: a }),
    );
    apply('Reviewed');
    await action;
    expect(f.writes.length).toBe(0);
    expect(
      f.sent.some(
        ({ body }) =>
          body.kind === 'error' && /range|context/.test(body.message),
      ),
    ).toBe(true);
  },
);

test('same-active range updates preserve parent/file handles without reloading details', async (t) => {
  const f = await setup();

  t.onTestFinished(() => f.controller.dispose());
  const detailCount = f.sent.filter(
    ({ body }) => body.kind === 'details',
  ).length;
  const files = f.sent.filter(({ body }) => body.kind === 'files').at(-1)!.body;

  assert.ok(files.kind === 'files');
  await f.controller.handle(
    f.request({ kind: 'select-commits', shas: [a, b, c], activeSha: a }),
  );
  await f.controller.handle(
    f.request({ kind: 'open-file', fileId: files.files[0]!.id, preview: true }),
  );
  expect(f.sent.filter(({ body }) => body.kind === 'details').length).toBe(
    detailCount,
  );
  expect(f.editors.length).toBe(1);
});

test('unknown range members and stale active identities never reach preflight', async (t) => {
  const f = await setup();

  t.onTestFinished(() => f.controller.dispose());
  let reads = 0;

  f.adapter.prepareSquash = async () => {
    reads++;
    throw new Error('Must not reach preflight');
  };

  await f.controller.handle(
    f.request({ kind: 'select-commits', shas: [a, replacement], activeSha: a }),
  );
  await f.controller.handle(
    f.request({
      kind: 'action',
      action: { ...squash, shas: [a, replacement] },
    }),
  );
  await f.controller.handle(
    f.request({ kind: 'action', action: { ...squash, activeSha: b } }),
  );
  expect(reads).toBe(0);
  expect(f.writes.length).toBe(0);
});

test('single-commit actions cannot operate on one member of a host-owned range', async (t) => {
  let copied = 0;
  const f = await setup({
    copyText: async () => {
      copied++;
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  for (const kind of [
    'copy-sha',
    'cherry-pick',
    'edit-commit-message',
  ] as const)
    await f.controller.handle(
      f.request({ kind: 'action', action: { kind, sha: a } }),
    );
  expect(f.writes.length).toBe(0);
  expect(copied).toBe(0);
  expect(
    f.sent.filter(
      ({ body }) =>
        body.kind === 'error' && /single|one commit/i.test(body.message),
    ).length,
  ).toBe(3);
});

test(
  'queued squash receives the original range cancellation signal',
  { timeout: 2000 },
  async (t) => {
    let queued!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      queued = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await setup({ askSquashMessage: async (message) => message });

    t.onTestFinished(() => f.controller.dispose());
    let writes = 0;
    let received: AbortSignal | undefined;
    let abortedWhenResumed: boolean | undefined;

    f.adapter.operate = async (_id, _action, context) => {
      received = context;
      queued();
      await wait;
      abortedWhenResumed = context?.aborted;
      if (!abortedWhenResumed) writes++;

      return { kind: 'cancelled', backend: null };
    };

    const action = f.controller.handle(
      f.request({ kind: 'action', action: squash }),
    );

    t.onTestFinished(async () => {
      release();
      await action;
    });
    await ready;
    await f.controller.handle(
      f.request({ kind: 'select-commits', shas: [a, b, c], activeSha: a }),
    );
    release();
    await action;
    // The handler catches callback errors, so assert cancellation after it returns.
    expect(received?.aborted).toBe(true);
    expect(abortedWhenResumed).toBe(true);
    expect(writes).toBe(0);
  },
);

for (const kind of ['error', 'conflict'] as const)
  test(
    `a started squash ${kind} remains visible after the user changes the range`,
    { timeout: 2000 },
    async (t) => {
      const notices: string[] = [];
      let finish!: () => void;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const f = await setup({
        askSquashMessage: async (draft) => draft,
        reportActionError: async (message) => {
          notices.push(message);
        },
      });

      t.onTestFinished(() => f.controller.dispose());
      f.adapter.operate = async () => {
        started();
        await wait;

        return {
          kind,
          backend: 'cli',
          message: 'Signing stopped the native rebase.',
        };
      };

      const action = f.controller.handle(
        f.request({ kind: 'action', action: squash }),
      );

      t.onTestFinished(async () => {
        finish();
        await action;
      });
      await ready;
      await f.controller.handle(
        f.request({ kind: 'select-commits', shas: [a, b, c], activeSha: a }),
      );
      finish();
      await action;
      expect(notices).toStrictEqual(['Signing stopped the native rebase.']);
      expect(
        f.sent.some(
          ({ body }) => body.kind === 'selection' && body.sha === replacement,
        ),
      ).toBe(false);
    },
  );
