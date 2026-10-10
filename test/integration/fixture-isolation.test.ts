import { realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, onTestFinished, test, vi } from 'vitest';

import { createFixture } from '../fixtures/repository';
import { createSquashFixture } from '../fixtures/squash-repository';

test.each([
  {
    name: 'repository',
    create: () => createFixture({ prefix: 'git-ui-native-isolated-' }),
  },
  { name: 'squash', create: () => createSquashFixture() },
])(
  '$name fixtures ignore inherited Git routing and config without changing another repository',
  async ({ create }) => {
    const other = await createFixture({
      prefix: 'git-ui-native-routing-target-',
    });

    onTestFinished(() => other.dispose());
    const before = await other.runGit(['rev-parse', 'HEAD']);

    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    for (const [name, value] of Object.entries({
      GIT_DIR: join(other.root, '.git'),
      GIT_WORK_TREE: other.root,
      GIT_INDEX_FILE: join(other.root, '.git/index'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'alias.status',
      GIT_CONFIG_VALUE_0: '!false',
    }))
      vi.stubEnv(name, value);
    const fixture = await create();

    onTestFinished(() => fixture.dispose());
    expect(
      await realpath(
        (await fixture.runGit(['rev-parse', '--show-toplevel'])).trim(),
      ),
    ).toBe(await realpath(fixture.root));
    expect((await fixture.runGit(['status', '--porcelain'])).trim()).toBe('');
    expect(await other.runGit(['rev-parse', 'HEAD'])).toBe(before);
    expect((await other.runGit(['status', '--porcelain'])).trim()).toBe('');
  },
);
