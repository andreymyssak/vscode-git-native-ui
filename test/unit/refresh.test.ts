import { assert, expect, test } from 'vitest';

import type { PanelBody, Result } from '../../src/shared/messages';
import { a, b, fixture, page } from '../fixtures/controller';

test('a click on refreshed history survives the older selection restoration', async (t) => {
  const sent: Result<PanelBody>[] = [];
  let release!: () => void;
  let historySent!: () => void;
  const refreshing = new Promise<void>((resolve) => {
    historySent = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(true, true, {
    send: async (message) => {
      sent.push(message);
      if (message.requestId === 'refresh' && message.body.kind === 'history') {
        historySent();
        await blocked;
      }
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.selectRepository('one');
  const refresh = f.controller.refresh();

  t.onTestFinished(async () => {
    release();
    await refresh;
  });
  await refreshing;
  await f.controller.handle(
    f.request({ kind: 'select-commit', sha: b }, 'one', 2),
  );
  release();
  await refresh;
  const selection = sent
    .filter((message) => message.body.kind === 'selection')
    .at(-1)?.body;

  assert.ok(
    !selection || (selection.kind === 'selection' && selection.sha === b),
  );
  const details = sent
    .filter((message) => message.body.kind === 'details')
    .at(-1)?.body;

  assert.ok(details?.kind === 'details');
  expect(details.commit.sha).toBe(b);
});
test('refresh preserves valid SHA file and scroll membership', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  f.adapter.history = async () => {
    const result = page([a, b]);

    result.commits[0]!.parents = [b];

    return result;
  };

  await f.controller.selectRepository('one');
  await f.controller.handle(f.request({ kind: 'select-commit', sha: a }));
  await f.controller.handle(
    f.request({ kind: 'open-file', fileId: `one-${a}`, preview: true }),
  );
  const anchor = { sha: a, offset: 5 };

  await f.controller.handle(f.request({ kind: 'anchor', anchor }));
  f.sent.length = 0;
  await f.controller.refresh();
  assert.ok(
    f.sent.some((m) => m.body.kind === 'details' && m.body.commit.sha === a),
  );
  assert.ok(f.sent.some((m) => m.body.kind === 'files' && m.body.sha === a));
  expect(
    f.sent.filter(({ body }) => body.kind === 'selection').at(-1)?.body,
  ).toStrictEqual({
    kind: 'selection',
    sha: a,
    parentSha: b,
    filePath: 'safe.txt',
    anchor,
  });
});
test('missing selection clears details and actions', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.selectRepository('one');
  await f.controller.handle(f.request({ kind: 'select-commit', sha: a }));
  f.adapter.history = async () => page([b]);
  f.sent.length = 0;
  await f.controller.refresh();
  const message = f.sent.find((m) => m.body.kind === 'selection')?.body;

  assert.ok(message?.kind === 'selection');
  expect(message.sha).toBe(null);
  await f.controller.handle(
    f.request(
      { kind: 'open-file', fileId: `one-${a}`, preview: true },
      'one',
      2,
    ),
  );
  expect(f.editors.length).toBe(0);
});
test('deleted explicit ref returns to HEAD with message', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.selectRepository('one');
  await f.controller.handle(
    f.request(
      {
        kind: 'history',
        scope: { kind: 'ref', refId: 'refs/heads/main' },
        text: '',
        cursor: null,
      },
      'one',
      2,
    ),
  );
  f.adapter.references = async () => [];
  f.sent.length = 0;
  await f.controller.refresh();
  const history = f.sent.find((m) => m.body.kind === 'history')?.body;

  assert.ok(history?.kind === 'history');
  expect(history.scope).toStrictEqual({ kind: 'head' });
  assert.ok(f.sent.some((m) => m.body.kind === 'notice'));
});
test('filter change clears invalid selection', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.selectRepository('one');
  await f.controller.handle(f.request({ kind: 'select-commit', sha: a }));
  f.adapter.history = async () => page([b]);
  f.sent.length = 0;
  await f.controller.handle(
    f.request(
      {
        kind: 'history',
        scope: { kind: 'head' },
        text: 'absent',
        cursor: null,
      },
      'one',
      2,
    ),
  );
  assert.ok(
    f.sent.some((m) => m.body.kind === 'selection' && m.body.sha === null),
  );
});
test('late parent response cannot restore old file', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.selectRepository('one');
  let reject!: (error: Error) => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });

  f.adapter.changes = () =>
    new Promise((_resolve, r) => {
      reject = r;
      entered();
    });
  const old = f.controller.handle(f.request({ kind: 'select-commit', sha: a }));

  await ready;
  t.onTestFinished(async () => {
    reject(new Error('Fixture closed'));
    await old;
  });
  f.adapter.changes = async () => [];
  await f.controller.handle(f.request({ kind: 'select-commit', sha: b }));
  reject(new Error('Old read failed'));
  await old;
  expect(
    f.sent.some(
      ({ body }) =>
        (body.kind === 'files' || body.kind === 'files-error') &&
        body.sha === a,
    ),
  ).toBe(false);
  expect(
    f.sent.filter(({ body }) => body.kind === 'files').at(-1)?.body,
  ).toMatchObject({ kind: 'files', sha: b });
  expect(
    f.sent.some(
      ({ body }) => body.kind === 'error' && body.message === 'Old read failed',
    ),
  ).toBe(false);
});
test('fresh query failure is reported at its assigned host generation', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.selectRepository('one');
  await f.controller.refresh();
  f.adapter.history = async () => {
    throw new Error('Read failed');
  };

  await f.controller.handle(
    f.request(
      {
        kind: 'history',
        scope: { kind: 'head' },
        text: 'filter',
        cursor: null,
      },
      'one',
      2,
    ),
  );
  const error = f.sent.at(-1);

  expect(error?.body.kind).toBe('error');
  expect(error?.generation).toBe(3);
});
test('repositories switch while loading without restoring the previous root', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  let release!: (value: ReturnType<typeof page>) => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });

  f.adapter.history = async (id) =>
    id === 'one'
      ? new Promise((resolve) => {
          release = resolve;
          entered();
        })
      : page([b]);
  const old = f.controller.selectRepository('one');

  await ready;
  t.onTestFinished(async () => {
    release(page([a]));
    await old;
  });
  await f.controller.selectRepository('two');
  release(page([a]));
  await old;
  const last = f.sent.filter((m) => m.body.kind === 'history').at(-1);

  expect(last?.repositoryId).toBe('two');
  assert.ok(
    !f.sent.some((m) => m.body.kind === 'history' && m.repositoryId === 'one'),
  );
});
test('new click supersedes an unfinished saved restoration', async (t) => {
  const sent: Result<PanelBody>[] = [];
  let release!: () => void;
  let shown!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const visible = new Promise<void>((resolve) => {
    shown = resolve;
  });
  const f = fixture(true, true, {
    send: async (message) => {
      sent.push(message);
      if (
        message.requestId === 'saved-restore' &&
        message.body.kind === 'history'
      ) {
        shown();
        await held;
      }
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.selectRepository('one');
  const restoration = f.controller.handle({
    ...f.request({
      kind: 'restore',
      scope: { kind: 'head' },
      text: '',
      selection: { sha: a, parentSha: null, filePath: null },
      anchor: null,
    }),
    requestId: 'saved-restore',
  });

  t.onTestFinished(async () => {
    release();
    await restoration;
  });
  await visible;
  await f.controller.handle(
    f.request({ kind: 'select-commit', sha: b }, 'one', 2),
  );
  release();
  await restoration;
  assert.ok(
    !sent.some(
      (message) =>
        message.requestId === 'saved-restore' &&
        message.body.kind === 'selection' &&
        message.body.sha === a,
    ),
  );
  const details = sent
    .filter((message) => message.body.kind === 'details')
    .at(-1)?.body;

  assert.ok(details?.kind === 'details');
  expect(details.commit.sha).toBe(b);
});
