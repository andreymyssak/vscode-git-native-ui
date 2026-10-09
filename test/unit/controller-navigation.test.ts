import { assert, expect, test } from 'vitest';

import type { PanelBody, Result } from '../../src/shared/messages';
import { a, b, fixture, page } from '../fixtures/controller';

test('a later branch navigation keeps the selected commit when an older resolution completes last', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });

  let entered!: () => void;
  const resolving = new Promise<void>((resolve) => {
    entered = resolve;
  });

  f.adapter.resolve = async (_id, input) => {
    if (input === 'refs/heads/older') {
      entered();
      await delayed;
    }

    return {
      kind: 'commit',
      commit: page([input === 'refs/heads/older' ? a : b]).commits[0]!,
    };
  };

  await f.controller.selectRepository('one');
  f.sent.length = 0;
  const older = f.controller.handle(
    f.request({ kind: 'go-to', input: 'refs/heads/older' }),
  );

  t.onTestFinished(async () => {
    release();
    await older;
  });
  await resolving;
  await f.controller.handle(
    f.request({ kind: 'go-to', input: 'refs/heads/newer' }),
  );
  release();
  await older;
  expect(
    f.sent
      .filter((message) => message.body.kind === 'reveal')
      .map((message) => message.body),
  ).toStrictEqual([{ kind: 'reveal', sha: b }]);
  expect(f.writes.length).toBe(0);
});

test('a later navigation retains selection when an older history publication finishes last', async (t) => {
  const sent: Result<PanelBody>[] = [];
  let release!: () => void;
  let entered!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const publishing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const c = 'c'.repeat(40);
  const f = fixture(true, true, {
    send: async (message) => {
      sent.push(message);
      if (message.requestId === 'older' && message.body.kind === 'history') {
        entered();
        await delayed;
      }
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  await f.controller.selectRepository('one');
  f.adapter.resolve = async (_id, input) => ({
    kind: 'commit',
    commit: page([input === 'older' ? c : b]).commits[0]!,
  });
  f.adapter.history = async () => page([a, b, c]);
  sent.length = 0;
  const older = f.controller.handle({
    ...f.request({ kind: 'go-to', input: 'older' }),
    requestId: 'older',
  });

  t.onTestFinished(async () => {
    release();
    await older;
  });
  await publishing;
  await f.controller.handle(f.request({ kind: 'go-to', input: 'newer' }));
  release();
  await older;
  expect(
    sent
      .filter((message) => message.body.kind === 'reveal')
      .map((message) => message.body),
  ).toStrictEqual([{ kind: 'reveal', sha: b }]);
  expect(f.writes.length).toBe(0);
});

test('an older failed navigation stays quiet while a current failure is reported', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  let reject!: (error: Error) => void;
  const delayed = new Promise<never>((_resolve, rejectFailure) => {
    reject = rejectFailure;
  });

  let entered!: () => void;
  const resolving = new Promise<void>((resolve) => {
    entered = resolve;
  });

  f.adapter.resolve = async (_id, input) => {
    if (input === 'older') {
      entered();

      return delayed;
    }

    if (input === 'current-error')
      throw new Error('Current reference read failed');

    return { kind: 'commit', commit: page([b]).commits[0]! };
  };

  await f.controller.selectRepository('one');
  f.sent.length = 0;
  const older = f.controller.handle(
    f.request({ kind: 'go-to', input: 'older' }),
  );

  t.onTestFinished(async () => {
    reject(new Error('Fixture closed'));
    await older;
  });
  await resolving;
  await f.controller.handle(f.request({ kind: 'go-to', input: 'newer' }));
  reject(new Error('Old reference read failed'));
  await older;
  expect(f.sent.filter((message) => message.body.kind === 'error').length).toBe(
    0,
  );
  await f.controller.handle(
    f.request({ kind: 'go-to', input: 'current-error' }),
  );
  expect(
    f.sent
      .filter((message) => message.body.kind === 'error')
      .map((message) => message.body),
  ).toStrictEqual([
    { kind: 'error', message: 'Current reference read failed' },
  ]);
  expect(f.writes.length).toBe(0);
});

test('declining navigation retains the query, selected file and scroll anchor through refresh', async (t) => {
  const outside = 'c'.repeat(40);
  const f = fixture(true, true, {
    offerNavigation: async (decision) => {
      expect(decision.kind).toBe('offer-clear');

      return false;
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  f.adapter.history = async (_id, input) =>
    input.scope.kind === 'all' ? page([outside]) : page([a, b]);
  f.adapter.resolve = async () => ({
    kind: 'commit',
    commit: page([outside]).commits[0]!,
  });
  await f.controller.selectRepository('one');
  await f.controller.handle(
    f.request({
      kind: 'history',
      scope: { kind: 'head' },
      text: 'needle',
      cursor: null,
    }),
  );
  await f.controller.handle(
    f.request({ kind: 'select-commit', sha: b }, 'one', 2),
  );
  await f.controller.handle(
    f.request(
      { kind: 'open-file', fileId: `one-${b}`, preview: true },
      'one',
      2,
    ),
  );
  await f.controller.handle(
    f.request({ kind: 'anchor', anchor: { sha: b, offset: 9 } }, 'one', 2),
  );
  f.sent.length = 0;
  await f.controller.handle(
    f.request({ kind: 'go-to', input: outside }, 'one', 2),
  );
  expect(f.sent.length).toBe(0);
  await f.controller.refresh();
  const history = f.sent
    .filter((message) => message.body.kind === 'history')
    .at(-1)?.body;

  assert.ok(history?.kind === 'history');
  expect(history.text).toBe('needle');
  expect(history.scope).toStrictEqual({ kind: 'head' });
  const selection = f.sent
    .filter((message) => message.body.kind === 'selection')
    .at(-1)?.body;

  expect(selection).toStrictEqual({
    kind: 'selection',
    sha: b,
    parentSha: null,
    filePath: 'safe.txt',
    anchor: { sha: b, offset: 9 },
  });
  expect(f.writes).toStrictEqual([]);
  f.controller.dispose();
});
