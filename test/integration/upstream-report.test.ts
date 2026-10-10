import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assert, expect, onTestFinished, test } from 'vitest';

import * as reporting from '../../scripts/upstream/report.ts';
import type { UpstreamTransport } from '../../scripts/upstream/types.ts';
import { prepareUpdate } from '../../scripts/upstream/update.ts';
import {
  parseDisposition,
  parseReview,
} from '../../scripts/upstream/validation.ts';

const old = 'a'.repeat(40);
const target = 'b'.repeat(40);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-ui-native upstream-report '));

  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'upstream/vscode/manifest.json');
  const source = join(root, 'upstream/vscode/originals/graph.ts');

  await mkdir(join(root, 'upstream/vscode/originals'), { recursive: true });
  await writeFile(source, '// graph\n');
  const hash = createHash('sha256').update('// graph\n').digest('hex');
  const manifest = {
    repository: 'microsoft/vscode',
    adoptedRevision: old,
    lastReviewedRevision: target,
    inputs: [
      {
        path: 'graph.ts',
        localPath: 'upstream/vscode/originals/graph.ts',
        role: 'copied',
        revision: old,
        sha256: hash,
      },
    ],
    patches: [],
    outputs: [],
    watched: [{ path: 'api.ts', category: 'api', revision: old, sha256: hash }],
  };

  await writeFile(path, JSON.stringify(manifest));
  const transport: UpstreamTransport = {
    file: async (_r, _v, p) =>
      Buffer.from(p === 'api.ts' ? '// API changed\n' : '// graph\n'),
    tree: async () => ['moved/graph.ts'],
  };

  return {
    root,
    path,
    source,
    transport,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

test('moved copied file reports missing and possible move', async () => {
  const f = await fixture();

  try {
    f.transport.file = async (_r, _v, p) =>
      p === 'graph.ts' ? null : Buffer.from('// graph\n');
    const report = await reporting.reportChanges(f.path, target, f.transport);
    const change = report.changes.find((c) => c.path === 'graph.ts');

    assert.ok(change);
    expect(change.state).toBe('missing');
    expect(change.possibleMoves).toStrictEqual(['moved/graph.ts']);
  } finally {
    await f.dispose();
  }
});
test('network failure cannot report no changes', async () => {
  const f = await fixture();

  try {
    f.transport.file = async () => {
      throw new Error('Offline');
    };

    const report = await reporting.reportChanges(f.path, target, f.transport);

    expect(report.status).toBe('failed');
    assert.ok(report.failures.length > 0);
  } finally {
    await f.dispose();
  }
});
test('watched API change is visible without copying', async () => {
  const f = await fixture();

  try {
    const before = await readFile(f.source);
    const report = await reporting.reportChanges(f.path, target, f.transport);
    const change = report.changes.find((c) => c.path === 'api.ts');

    assert.ok(change);
    expect(change.kind).toBe('watched');
    expect(change.state).toBe('changed');
    expect(await readFile(f.source)).toStrictEqual(before);
  } finally {
    await f.dispose();
  }
});
test('reviewed revision differs from adopted revisions', async () => {
  const f = await fixture();

  try {
    const report = await reporting.reportChanges(f.path, target, f.transport);

    expect(report.lastReviewedRevision).toBe(target);
    expect(report.adoptedRevisions).toStrictEqual([old]);
  } finally {
    await f.dispose();
  }
});
test('deferral requires reason and revisit condition', async () => {
  expect(() => parseDisposition({ type: 'deferred' })).toThrow(
    /reason|revisit/,
  );
  expect(() =>
    parseDisposition({
      type: 'deferred',
      reason: 'Not in current scope',
      revisit: 'Before adding merge actions',
    }),
  ).not.toThrow();
});
test('prepared update never overwrites live inputs', async () => {
  const f = await fixture();

  try {
    const before = await Promise.all([readFile(f.source), readFile(f.path)]);

    await prepareUpdate(
      f.path,
      target,
      join(f.root, '.artifacts/prepared'),
      f.transport,
    );
    expect(
      await Promise.all([readFile(f.source), readFile(f.path)]),
    ).toStrictEqual(before);
    expect(
      JSON.parse(
        await readFile(
          join(f.root, '.artifacts/prepared/upstream/vscode/manifest.json'),
          'utf8',
        ),
      ).adoptedRevision,
    ).toBe(target);
    await expect(
      prepareUpdate(f.path, target, f.root, f.transport),
    ).rejects.toThrow(/live|owned|empty/);
  } finally {
    await f.dispose();
  }
});
test('review cannot approve failed or undispositioned changes', async () => {
  const f = await fixture();

  try {
    const report = await reporting.reportChanges(f.path, target, f.transport);

    expect(() => parseReview(report)).toThrow(/disposition/);
    const reviewed = {
      ...report,
      changes: report.changes.map((change) => ({
        ...change,
        disposition: { type: 'integration required' },
      })),
    };

    expect(() => parseReview(reviewed)).not.toThrow();
    expect(() =>
      parseReview({
        ...reviewed,
        status: 'failed',
        failures: [{ message: 'Offline' }],
      }),
    ).toThrow(/failed|failure/);
  } finally {
    await f.dispose();
  }
});
