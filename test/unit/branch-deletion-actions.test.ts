import { expect, test } from 'vitest';

import { a, b, fixture, page } from '../fixtures/controller';

for (const target of ['known', 'current', 'unknown'] as const)
  test(`batch branch deletion ${target} target preserves ownership`, async (t) => {
    const f = fixture();

    t.onTestFinished(() => f.controller.dispose());
    f.adapter.history = async () => ({
      ...page([a]),
      refs: [
        ...page([]).refs,
        ...['alpha', 'beta'].map((name, index) => ({
          id: `refs/heads/${name}`,
          name,
          kind: 'local' as const,
          sha: index ? b : a,
          remote: null,
        })),
      ],
    });
    await f.controller.selectRepository('one');
    await f.controller.handle(
      f.request({
        kind: 'action',
        action: {
          kind: 'delete-branches',
          refIds: [
            'refs/heads/alpha',
            target === 'current'
              ? 'refs/heads/main'
              : target === 'unknown'
                ? 'refs/heads/foreign'
                : 'refs/heads/beta',
          ],
        },
      }),
    );
    expect(f.writes).toStrictEqual(
      target !== 'known'
        ? []
        : [
            {
              id: 'one',
              action: {
                kind: 'delete-branches',
                branches: [
                  { refId: 'refs/heads/alpha', expectedSha: a },
                  { refId: 'refs/heads/beta', expectedSha: b },
                ],
              },
            },
          ],
    );
    f.controller.dispose();
  });
