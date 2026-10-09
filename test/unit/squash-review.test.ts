import { expect, test } from 'vitest';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { QuerySession } from '../../src/extension/panel/queries';
import { reviewSquash } from '../../src/extension/panel/squash';
import type { Request, RequestBody } from '../../src/shared/messages';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);

function fixture() {
  const session = new QuerySession();

  session.begin('one');
  session.repositoryInfo = {
    id: 'one',
    label: 'one',
    rootUri: 'file:///one',
    branch: 'main',
    headSha: a,
  };
  for (const [sha, parent] of [
    [a, b],
    [b, c],
    [c, 'd'.repeat(40)],
  ] as const)
    session.commits.set(sha, {
      sha,
      parents: [parent],
      message: sha,
      authorName: null,
      authorEmail: null,
      authorDate: null,
      commitDate: null,
    });
  session.selectRange([a, b], a);
  const snapshot = {
    shas: [a, b],
    expectedBranch: 'main',
    expectedHeadSha: a,
    replayShas: [b, a],
    oldestToNewest: [b, a],
    oldestParentSha: c,
    treeSha: 'f'.repeat(40),
    messages: ['Older full\n\nBody ü', 'Latest full'],
  };
  const adapter = { prepareSquash: async () => snapshot } as Pick<
    GitAdapter,
    'prepareSquash'
  >;
  const request: Request<RequestBody> = {
    requestId: 'menu',
    repositoryId: 'one',
    generation: 1,
    body: {
      kind: 'action',
      action: { kind: 'squash-commits', shas: [a, b], activeSha: a },
    },
  };

  return { session, snapshot, adapter, request, shas: [a, b], activeSha: a };
}

test('the native review uses full oldest-first messages and unchanged Apply still prepares a squash', async () => {
  const f = fixture();
  const reviewed = await reviewSquash({
    ...f,
    askMessage: async (draft, branch, count) => {
      expect(draft).toBe('Older full\n\nBody ü\n\nLatest full');
      expect(branch).toBe('main');
      expect(count).toBe(2);

      return draft;
    },
  });

  expect(reviewed?.action).toStrictEqual({
    kind: 'squash-commits',
    target: { shas: [a, b], expectedBranch: 'main', expectedHeadSha: a },
    message: 'Older full\n\nBody ü\n\nLatest full',
  });
  expect(reviewed?.context.aborted).toBe(false);
  f.session.selectRange([a, b, c], a);
  expect(
    reviewed?.context.aborted,
    'queue cancellation must use the original reviewed range signal',
  ).toBe(true);
});
test('a changed range with the same active row cannot apply its open draft', async () => {
  const f = fixture();
  let apply!: (message: string) => void;
  const editor = new Promise<string>((resolve) => {
    apply = resolve;
  });
  let opened!: () => void;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const reviewing = reviewSquash({
    ...f,
    askMessage: async () => {
      opened();

      return editor;
    },
  });

  await ready;
  f.session.selectRange([a, b, c], a);
  apply('Reviewed');
  await expect(reviewing).rejects.toThrow(/range|history|context/i);
});
test('changing context during preflight prevents opening the message editor', async () => {
  const f = fixture();
  let opened = 0;

  f.adapter.prepareSquash = async () => {
    f.session.selectRange([a, b, c], a);

    return f.snapshot;
  };

  await expect(
    reviewSquash({
      ...f,
      askMessage: async () => {
        opened++;

        return 'Reviewed';
      },
    }),
  ).rejects.toThrow(/range|history|context/i);
  expect(opened).toBe(0);
});
test('cancel and disposal while a review is open produce no reviewed write', async () => {
  const f = fixture();

  expect(await reviewSquash({ ...f, askMessage: async () => null })).toBe(null);
  await expect(
    reviewSquash({
      ...f,
      askMessage: async () => {
        f.session.dispose();

        return 'Reviewed';
      },
    }),
  ).rejects.toThrow(/range|history|context/i);
});
test('unloaded, stale or unowned selections reject before preflight', async () => {
  for (const variant of ['unloaded', 'stale', 'unowned'] as const) {
    const f = fixture();
    let prepared = 0;

    f.adapter.prepareSquash = async () => {
      prepared++;

      return f.snapshot;
    };

    if (variant === 'unloaded') f.session.commits.delete(b);
    if (variant === 'stale') f.request.generation = 0;
    if (variant === 'unowned') f.session.selectRange([a, b, c], a);
    await expect(
      reviewSquash({ ...f, askMessage: async () => 'Reviewed' }),
    ).rejects.toThrow(/range|history|context|loaded/i);
    expect(prepared).toBe(0);
  }
});
test('branch or HEAD changes while the editor is open invalidate Apply', async () => {
  for (const patch of [{ branch: 'other' }, { headSha: c }]) {
    const f = fixture();

    await expect(
      reviewSquash({
        ...f,
        askMessage: async () => {
          f.session.repositoryInfo = { ...f.session.repositoryInfo!, ...patch };

          return 'Reviewed';
        },
      }),
    ).rejects.toThrow(/branch|HEAD|context|history/i);
  }
});
test('native draft validation rejects blank, NUL and more than one MiB of UTF-8', async () => {
  for (const draft of [' \n', 'Message\0', 'ü'.repeat(512 * 1024 + 1)]) {
    const f = fixture();

    await expect(
      reviewSquash({ ...f, askMessage: async () => draft }),
    ).rejects.toThrow(/blank|NUL|MiB/i);
  }
});
