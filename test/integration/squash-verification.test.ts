import { expect, test } from 'vitest';

import { validateSquash, verifySquash } from '../../src/extension/git/squash';
import { createSquashFixture } from '../fixtures/squash-repository';

test('postflight returns the exact single replacement with the original final tree and base', async (t) => {
  const fixture = await createSquashFixture();

  t.onTestFinished(() => fixture.dispose());
  try {
    const snapshot = await validateSquash(
      fixture.access,
      fixture.cli,
      'fixture',
      fixture.target,
    );
    const replacement = (
      await fixture.runGit([
        'commit-tree',
        snapshot.treeSha,
        '-p',
        fixture.initial,
        '-m',
        'Combined',
      ])
    ).trim();

    await fixture.runGit(['update-ref', 'refs/heads/main', replacement]);
    const before = await fixture.state();

    expect(await verifySquash(fixture.cli, 'fixture', snapshot)).toBe(
      replacement,
    );
    expect(await fixture.state()).toStrictEqual(before);
    expect(
      (await fixture.runGit(['rev-parse', 'retained-branch'])).trim(),
    ).toBe(fixture.a);
    expect((await fixture.runGit(['rev-parse', 'retained-tag'])).trim()).toBe(
      fixture.b,
    );
  } finally {
    await fixture.dispose();
  }
});

for (const defect of [
  'no replacement',
  'wrong parent',
  'wrong tree',
  'extra commit',
  'changed branch',
] as const) {
  test(`postflight reports ${defect} with old/new identities and performs no rollback`, async (t) => {
    const fixture = await createSquashFixture();

    t.onTestFinished(() => fixture.dispose());
    try {
      const snapshot = await validateSquash(
        fixture.access,
        fixture.cli,
        'fixture',
        fixture.target,
      );

      if (defect !== 'no replacement') {
        const tree =
          defect === 'wrong tree'
            ? (
                await fixture.runGit(['rev-parse', `${fixture.initial}^{tree}`])
              ).trim()
            : snapshot.treeSha;
        const parent = defect === 'wrong parent' ? fixture.a : fixture.initial;
        let replacement = (
          await fixture.runGit([
            'commit-tree',
            tree,
            '-p',
            parent,
            '-m',
            'Replacement',
          ])
        ).trim();

        if (defect === 'extra commit')
          replacement = (
            await fixture.runGit([
              'commit-tree',
              tree,
              '-p',
              replacement,
              '-m',
              'Extra',
            ])
          ).trim();
        await fixture.runGit(['update-ref', 'refs/heads/main', replacement]);
        if (defect === 'changed branch')
          await fixture.runGit(['checkout', '-b', 'moved']);
      }

      const before = await fixture.state();
      const verification = verifySquash(fixture.cli, 'fixture', snapshot);

      await expect(verification).rejects.toThrow(
        /verif|parent|tree|replacement|branch|postcondition/i,
      );
      await expect(verification).rejects.toThrow(fixture.c);
      await expect(verification).rejects.toThrow(before.head);
      expect(await fixture.state()).toStrictEqual(before);
    } finally {
      await fixture.dispose();
    }
  });
}
