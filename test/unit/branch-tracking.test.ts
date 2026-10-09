import { expect, test } from 'vitest';

import type { GitApiAccess } from '../../src/extension/git/api';
import type { GitCli } from '../../src/extension/git/cli';
import { readReferences } from '../../src/extension/git/resolve';

test('tracking counts belong to the exact local tip and missing upstream is unknown', async () => {
  const sha = 'a'.repeat(40);
  const access = {
    repository: () => ({
      getRefs: async () => [
        { type: 0, name: 'main', commit: sha },
        { type: 0, name: 'gone', commit: sha },
        { type: 0, name: 'topic', commit: sha },
        { type: 1, name: 'origin/main', commit: sha },
      ],
    }),
  } as unknown as GitApiAccess;
  const cli = {
    run: async () =>
      [
        `refs/heads/main\0${sha}\0refs/remotes/origin/main\0[ahead 2, behind 105]`,
        `refs/heads/gone\0${sha}\0refs/remotes/origin/gone\0[gone]`,
        `refs/heads/topic\0${'b'.repeat(40)}\0refs/remotes/origin/topic\0[behind 1]`,
      ].join('\n'),
  } as unknown as GitCli;
  const refs = await readReferences(access, 'one', cli);

  expect(refs[0]?.tracking).toStrictEqual({
    upstream: 'refs/remotes/origin/main',
    ahead: 2,
    behind: 105,
  });
  expect(refs[1]?.tracking).toStrictEqual({
    upstream: 'refs/remotes/origin/gone',
    ahead: null,
    behind: null,
  });
  expect(refs[2]?.tracking).toBe(undefined);
  expect(refs[3]?.tracking).toBe(undefined);
});
