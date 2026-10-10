import { assert, expect, test } from 'vitest';

import {
  commitMenuRequest,
  parseRequest,
} from '../../src/extension/panel/protocol';
import { QuerySession } from '../../src/extension/panel/queries';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const envelope = (body: unknown) => ({
  requestId: 'range',
  repositoryId: 'one',
  generation: 1,
  body,
});

test('range protocol accepts only distinct full commit identities with an active member', () => {
  const range = { shas: [a, b], activeSha: a };

  assert.ok(parseRequest(envelope({ kind: 'select-commits', ...range })));
  assert.ok(
    parseRequest(
      envelope({
        kind: 'action',
        action: { kind: 'squash-commits', ...range },
      }),
    ),
  );
  for (const forged of [
    { shas: [], activeSha: a },
    { shas: [a, a], activeSha: a },
    { shas: [a, b.slice(0, 8)], activeSha: a },
    { shas: [a, b], activeSha: c },
    { shas: [a, b], activeSha: a, command: 'reset' },
    { shas: [a, b], activeSha: a, helperPath: '/outside' },
  ]) {
    expect(parseRequest(envelope({ kind: 'select-commits', ...forged }))).toBe(
      null,
    );
    expect(
      parseRequest(
        envelope({
          kind: 'action',
          action: { kind: 'squash-commits', ...forged },
        }),
      ),
    ).toBe(null);
  }

  expect(
    parseRequest(
      envelope({
        kind: 'action',
        action: { kind: 'squash-commits', shas: [a], activeSha: a },
      }),
    ),
  ).toBe(null);
});
test('native range menu sends the whole selection and refuses single actions on multiple members', () => {
  const context = {
    repositoryId: 'one',
    generation: 1,
    commitSha: b,
    commitShas: [a, b],
    commitSelectionCount: 2,
  };

  expect(commitMenuRequest('squash-commits', context)?.body).toStrictEqual({
    kind: 'action',
    action: { kind: 'squash-commits', shas: [a, b], activeSha: b },
  });
  for (const kind of ['copy-sha', 'edit-commit-message'] as const)
    expect(commitMenuRequest(kind, context)).toBe(null);
  expect(
    commitMenuRequest('squash-commits', {
      ...context,
      commitSelectionCount: 3,
    }),
  ).toBe(null);
});
test('a native single-commit action cannot conceal a range with a forged or missing count', () => {
  const context = {
    repositoryId: 'one',
    generation: 1,
    commitSha: a,
    commitShas: [a, b],
  };

  for (const kind of ['copy-sha', 'edit-commit-message'] as const) {
    expect(commitMenuRequest(kind, context)).toBe(null);
    expect(
      commitMenuRequest(kind, {
        ...context,
        commitSelectionCount: 1,
      }),
    ).toBe(null);
  }
});
test('native Cherry-Pick and Drop reject mismatched counts and forged range fields', () => {
  const context = {
    repositoryId: 'one',
    generation: 1,
    commitSha: a,
    commitShas: [a, b],
    commitSelectionCount: 2,
  };

  for (const kind of ['cherry-pick', 'drop-commits'] as const) {
    assert.ok(commitMenuRequest(kind, context));
    for (const changed of [
      { commitSelectionCount: 1 },
      { commitSelectionCount: undefined },
      { commitSha: c },
      { commitShas: [a, a] },
      { commitShas: [a, '--reset'] },
    ])
      expect(commitMenuRequest(kind, { ...context, ...changed })).toBe(null);
  }

  for (const kind of ['cherry-pick-commits', 'drop-commits'])
    expect(
      parseRequest(
        envelope({
          kind: 'action',
          action: { kind, shas: [a, b], activeSha: a, expectedBranch: 'main' },
        }),
      ),
    ).toBe(null);
});
test('changing the range with an unchanged active row cancels its captured signal and keeps its file context', (t) => {
  const session = new QuerySession();

  t.onTestFinished(() => session.dispose());
  session.begin('one');
  session.selectRange([a, b, c], a);
  session.selection = { sha: a, parentSha: b, filePath: 'src/file.ts' };
  session.files.set('file', {
    sha: a,
    parentSha: b,
    file: {
      id: 'file',
      status: 'modified',
      oldPath: 'src/file.ts',
      newPath: 'src/file.ts',
    },
  });
  const signal = session.rangeAbort.signal;
  const revision = session.rangeRevision;
  const epoch = session.detailEpoch;

  session.selectRange([a, b], a);
  expect(signal.aborted).toBe(true);
  expect(session.rangeRevision).toBe(revision + 1);
  expect(session.detailEpoch).toBe(epoch);
  expect(session.selection.filePath).toBe('src/file.ts');
  expect(session.files.size).toBe(1);
});
test('repeated identical ranges preserve ownership and copy the caller identities', (t) => {
  const session = new QuerySession();

  t.onTestFinished(() => session.dispose());
  session.begin('one');
  const identities = [a, b];

  session.selectRange(identities, a);
  const signal = session.rangeAbort.signal;
  const revision = session.rangeRevision;

  identities[1] = c;
  expect(session.selectedShas).toStrictEqual([a, b]);
  session.selectRange([a, b], a);
  expect(session.rangeAbort.signal).toBe(signal);
  expect(signal.aborted).toBe(false);
  expect(session.rangeRevision).toBe(revision);
});
test('repository replacement and disposal invalidate range ownership', (t) => {
  const session = new QuerySession();

  t.onTestFinished(() => session.dispose());
  session.begin('one');
  session.selectRange([a, b], a);
  const old = session.rangeAbort.signal;

  session.begin('two');
  expect(old.aborted).toBe(true);
  expect(session.selectedShas).toStrictEqual([]);
  session.selectRange([a, b], a);
  const current = session.rangeAbort.signal;

  session.dispose();
  expect(current.aborted).toBe(true);
});
