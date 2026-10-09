import { expect, test } from 'vitest';

import { a, b, fixture, page } from '../fixtures/controller';

test('overlapping initial and parent requests share a comparison read and publish one result', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  const history = page([a, b]);

  history.commits[0]!.parents = [b];
  f.adapter.history = async () => history;
  let reads = 0;
  let complete!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const comparison = new Promise<void>((resolve) => {
    complete = resolve;
  });

  f.adapter.changes = async () => {
    reads++;
    started();
    await comparison;

    return [];
  };

  try {
    await f.controller.selectRepository('one');
    f.sent.length = 0;
    const select = f.controller.handle(
      f.request({ kind: 'select-commit', sha: a }),
    );

    await waiting;
    const duplicate = f.controller.handle(
      f.request({ kind: 'load-parent', sha: a, parentSha: b }),
    );

    complete();
    await Promise.all([select, duplicate]);
    expect(reads).toBe(1);
    expect(
      f.sent
        .filter(({ body }) => body.kind === 'files')
        .map(({ body }) => body),
    ).toStrictEqual([{ kind: 'files', sha: a, parentSha: b, files: [] }]);
  } finally {
    f.controller.dispose();
  }
});
test('a missing parent is reported for that comparison rather than as an empty result or global failure', async (t) => {
  const f = fixture();

  t.onTestFinished(() => f.controller.dispose());
  const history = page([a, b]);

  history.commits[0]!.parents = [b];
  f.adapter.history = async () => history;
  f.adapter.changes = async () => {
    throw new Error('Parent object unavailable.');
  };

  try {
    await f.controller.selectRepository('one');
    f.sent.length = 0;
    await f.controller.handle(f.request({ kind: 'select-commit', sha: a }));
    expect(f.sent.map(({ body }) => body)).toStrictEqual([
      { kind: 'details', commit: history.commits[0] },
      {
        kind: 'files-error',
        sha: a,
        parentSha: b,
        message: 'Parent object unavailable.',
      },
    ]);
  } finally {
    f.controller.dispose();
  }
});
