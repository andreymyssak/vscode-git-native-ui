import { expect, test } from 'vitest';

import type { Reference } from '../../src/shared/model';
import { a, b, fixture } from '../fixtures/controller';

const branches: Reference[] = [
  {
    id: 'refs/heads/topic',
    name: 'topic',
    kind: 'local',
    sha: b,
    remote: null,
  },
  {
    id: 'refs/remotes/origin/main',
    name: 'origin/main',
    kind: 'remote',
    sha: a,
    remote: 'origin',
  },
  { id: 'refs/tags/v1', name: 'v1', kind: 'tag', sha: a, remote: null },
];

for (const ref of branches.filter((ref) => ref.kind !== 'tag'))
  test(`toolbar creation uses the native ${ref.kind} branch choice and refreshes the list`, async (t) => {
    const f = fixture(true, true, {
      pickWorktreeBranch: async (choices, current) => {
        expect(choices).toStrictEqual(branches.slice(0, 2));
        expect(current).toBe('main');

        return ref.id;
      },
      askWorktree: async (reference, rootUri, current) => {
        expect(reference).toStrictEqual(ref);
        expect(rootUri).toBe('file:///fixture/one');
        expect(current).toBe('main');

        return { path: '/fixture/created', name: 'new-topic' };
      },
    });

    t.onTestFinished(() => f.controller.dispose());
    f.adapter.references = async () => branches;
    const created = {
      id: 'created',
      name: 'created',
      rootUri: 'file:///fixture/created',
      branch: 'new-topic',
      current: false,
      main: false,
      available: true,
    };

    f.adapter.worktrees = async () => (f.writes.length ? [created] : []);
    try {
      await f.controller.handle(
        f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
      );
      await f.controller.handle(
        f.request({ kind: 'action', action: { kind: 'create-worktree' } }),
      );
      expect(f.writes).toStrictEqual([
        {
          id: 'one',
          action: {
            kind: 'create-worktree',
            refId: ref.id,
            expectedSha: ref.sha,
            path: '/fixture/created',
            name: 'new-topic',
          },
        },
      ]);
      expect(
        f.sent.filter(({ body }) => body.kind === 'worktrees').at(-1)?.body,
      ).toStrictEqual({ kind: 'worktrees', worktrees: [created] });
    } finally {
      f.controller.dispose();
    }
  });
for (const cancel of ['branch', 'folder'] as const)
  test(`cancelling the ${cancel} prompt creates nothing`, async (t) => {
    let folders = 0;
    const f = fixture(true, true, {
      pickWorktreeBranch: async () =>
        cancel === 'branch' ? null : branches[0]!.id,
      askWorktree: async () => {
        folders++;

        return null;
      },
    });

    t.onTestFinished(() => f.controller.dispose());
    f.adapter.references = async () => branches;
    try {
      await f.controller.handle(
        f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
      );
      await f.controller.handle(
        f.request({ kind: 'action', action: { kind: 'create-worktree' } }),
      );
      expect(folders).toBe(cancel === 'folder' ? 1 : 0);
      expect(f.writes).toStrictEqual([]);
    } finally {
      f.controller.dispose();
    }
  });
for (const change of ['repository', 'generation', 'disposed'] as const)
  for (const stage of ['branches', 'branch picker', 'folder'] as const)
    test(`${change} during ${stage} prevents worktree creation`, async (t) => {
      let answer!: () => void;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = () =>
        new Promise<void>((resolve) => {
          answer = resolve;
          entered();
        });
      const f = fixture(true, true, {
        pickRepository: async () => 'two',
        pickWorktreeBranch: async () => {
          if (stage === 'branch picker') await wait();

          return branches[0]!.id;
        },
        askWorktree: async () => {
          if (stage === 'folder') await wait();

          return { path: '/fixture/created', name: null };
        },
      });

      t.onTestFinished(() => f.controller.dispose());
      f.adapter.references = async () => {
        if (stage === 'branches') await wait();

        return branches;
      };

      try {
        await f.controller.handle(
          f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
        );
        const pending = f.controller.handle(
          f.request({ kind: 'action', action: { kind: 'create-worktree' } }),
        );

        await ready;
        t.onTestFinished(async () => {
          answer();
          await pending;
        });
        if (change === 'repository')
          await f.controller.handle(f.request({ kind: 'choose-repository' }));
        else if (change === 'generation')
          await f.controller.handle(f.request({ kind: 'refresh' }));
        else f.controller.dispose();
        answer();
        await pending;
        expect(f.writes).toStrictEqual([]);
      } finally {
        f.controller.dispose();
      }
    });
for (const target of ['foreign', 'refs/tags/v1'])
  test(`a native branch choice outside the offered branches (${target}) is rejected`, async (t) => {
    const f = fixture(true, true, {
      pickWorktreeBranch: async () => target,
      askWorktree: async () => {
        throw new Error('Unexpected folder prompt');
      },
    });

    t.onTestFinished(() => f.controller.dispose());
    f.adapter.references = async () => branches;
    try {
      await f.controller.handle(
        f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
      );
      await f.controller.handle(
        f.request({ kind: 'action', action: { kind: 'create-worktree' } }),
      );
      expect(f.writes).toStrictEqual([]);
      expect(JSON.stringify(f.sent.at(-1)?.body)).toMatch(
        /Select a local or remote branch/,
      );
    } finally {
      f.controller.dispose();
    }
  });
test('creation from a branch row retains its displayed SHA and bypasses the branch picker', async (t) => {
  const f = fixture(true, true, {
    pickWorktreeBranch: async () => {
      throw new Error('Unexpected branch picker');
    },
    askWorktree: async (ref) => {
      expect(ref.sha).toBe(a);

      return { path: '/fixture/new', name: 'new-main' };
    },
  });

  t.onTestFinished(() => f.controller.dispose());
  f.adapter.references = async () => [
    { ...branches[0]!, id: 'refs/heads/main', name: 'main', sha: b },
  ];
  try {
    await f.controller.handle(
      f.request({ kind: 'ready', savedRepositoryId: null }, '', 0),
    );
    await f.controller.handle(
      f.request({
        kind: 'action',
        action: { kind: 'create-worktree', refId: 'refs/heads/main' },
      }),
    );
    expect(f.writes).toStrictEqual([
      {
        id: 'one',
        action: {
          kind: 'create-worktree',
          refId: 'refs/heads/main',
          expectedSha: a,
          path: '/fixture/new',
          name: 'new-main',
        },
      },
    ]);
  } finally {
    f.controller.dispose();
  }
});
