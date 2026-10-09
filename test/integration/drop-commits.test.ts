import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createOperations } from '../../src/extension/git/operations';
import { createSquashFixture } from '../fixtures/squash-repository';

for (const count of [1, 2, 3]) {
  test(`Drop removes a ${count}-commit suffix, restores its base files and keeps other refs`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    const repository = fixture.access.repository('fixture');

    repository.status = async () => {};

    const operate = createOperations(fixture.access, fixture.cli, {
      updateDiverged: async () => null,
      remoteCheckout: async () => null,
    });
    const target = {
      ...fixture.target,
      shas: fixture.target.shas.slice(0, count),
    };
    const base = [fixture.b, fixture.a, fixture.initial][count - 1]!;

    try {
      const result = await operate('fixture', { kind: 'drop-commits', target });

      expect(result.kind).toBe('success');
      expect(result.kind === 'success' ? result.replacementSha : null).toBe(
        base,
      );
      expect((await fixture.runGit(['rev-parse', 'HEAD'])).trim()).toBe(base);
      expect((await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim()).toBe(
        (await fixture.runGit(['rev-parse', `${base}^{tree}`])).trim(),
      );
      expect(
        (await fixture.runGit(['rev-parse', 'retained-branch'])).trim(),
      ).toBe(fixture.a);
      expect((await fixture.runGit(['rev-parse', 'retained-tag'])).trim()).toBe(
        fixture.b,
      );
      expect(
        await fixture.runGit([
          'status',
          '--porcelain',
          '--untracked-files=all',
        ]),
      ).toBe('');
    } finally {
      await fixture.dispose();
    }
  });
}

for (const scenario of [
  'older',
  'gap',
  'root',
  'published',
  'dirty',
  'operation',
  'changed-head',
  'cancelled',
  'changed-at-boundary',
] as const) {
  test(`Drop refuses ${scenario} without changing refs, index or files`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    const target = { ...fixture.target, shas: [...fixture.target.shas] };
    const context = new AbortController();

    fixture.access.repository('fixture').status = async () => {};

    if (scenario === 'older') target.shas = [fixture.b, fixture.a];
    if (scenario === 'gap') target.shas = [fixture.c, fixture.a];
    if (scenario === 'root') target.shas.push(fixture.initial);
    if (scenario === 'published')
      await fixture.runGit([
        'update-ref',
        'refs/remotes/origin/main',
        fixture.c,
      ]);
    if (scenario === 'dirty')
      await writeFile(join(fixture.root, 'local.txt'), 'local');
    if (scenario === 'operation')
      await mkdir(join(fixture.root, '.git', 'sequencer'));
    if (scenario === 'changed-head') target.expectedHeadSha = fixture.b;
    if (scenario === 'cancelled') context.abort();
    const before = await fixture.state();
    let escapedFinalGuard = 0;
    const cli = {
      run: async (...args: Parameters<typeof fixture.cli.run>) => {
        if (scenario === 'changed-at-boundary' && args[1][0] === 'reset') {
          context.abort();
          await args[3]?.();
          escapedFinalGuard++;

          return '';
        }

        return fixture.cli.run(...args);
      },
    };
    const operate = createOperations(fixture.access, cli, {
      updateDiverged: async () => null,
      remoteCheckout: async () => null,
    });

    try {
      const result = await operate(
        'fixture',
        { kind: 'drop-commits', target },
        context.signal,
      );

      expect(result.kind).toBe(
        scenario === 'cancelled' || scenario === 'changed-at-boundary'
          ? 'cancelled'
          : 'error',
      );
      expect(escapedFinalGuard).toBe(0);
      expect(await fixture.state()).toStrictEqual(before);
    } finally {
      await fixture.dispose();
    }
  });
}
