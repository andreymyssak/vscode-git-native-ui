import { expect, test } from 'vitest';

import { FileIconSession } from '../../src/extension/panel/file-icon-session';

test('newest theme refresh wins across pending reads and ready publishes the latest result', async (t) => {
  const publications: string[] = [];
  const pending: ((value: string) => void)[] = [];
  const session = new FileIconSession({
    load: () => new Promise<string>((resolve) => pending.push(resolve)),
    publish: async (value) => {
      publications.push(value ?? 'fallback');
    },
  });

  t.onTestFinished(() => session.dispose());
  const old = session.refresh();
  const next = session.refresh();

  session.ready();
  pending[1]!('new');
  await next;
  pending[0]!('old');
  await old;
  expect(publications).toStrictEqual(['new']);
  session.dispose();
});
test('disposal prevents late publication and failed theme loading emits the fallback', async (t) => {
  const publications: (string | null)[] = [];
  let finish: ((value: string) => void) | undefined;
  const session = new FileIconSession({
    load: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    publish: async (value) => {
      publications.push(value);
    },
  });

  t.onTestFinished(() => session.dispose());
  session.ready();
  const pending = session.refresh();

  session.dispose();
  finish!('late');
  await pending;
  expect(publications.length).toBe(0);
  const failure = new FileIconSession<string>({
    load: async () => {
      throw new Error('unavailable');
    },
    publish: async (value) => {
      publications.push(value);
    },
  });

  t.onTestFinished(() => failure.dispose());
  failure.ready();
  await failure.refresh();
  expect(publications).toStrictEqual([null]);
  failure.dispose();
});
