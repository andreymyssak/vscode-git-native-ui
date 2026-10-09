import { expect, test } from 'vitest';

import type { GitRef, GitRepository } from '../../src/extension/git/api';
import { historyChangeFilter } from '../../src/extension/git/history-events';

test('history status filtering uses live references and ignores reordered, unchanged metadata', async () => {
  const head = { type: 0 as const, name: 'main', commit: 'a'.repeat(40) };
  const tag = { type: 2 as const, name: 'v1', commit: head.commit };
  let refs: GitRef[] = [head, tag];
  let failed = false;
  const state = { HEAD: head, worktrees: [], remotes: [] };
  const repository = {
    state,
    getRefs: async () => {
      if (failed) throw new Error('Reference lookup failed');

      return [...refs];
    },
  } as unknown as GitRepository;
  let changes = 0;
  const observation = historyChangeFilter(repository, () => {
    changes++;
  });
  const notify = () => observation.check();

  await notify();
  refs = [tag, head];
  await notify();
  expect(changes).toBe(0);
  refs = [...refs, { ...head, name: 'feature' }];
  await notify();
  expect(changes, 'a branch at the same HEAD must refresh history').toBe(1);
  await notify();
  expect(changes).toBe(1);
  state.HEAD = { ...head, name: 'feature' };
  await notify();
  expect(changes, 'checkout at the same commit must refresh history').toBe(2);
  failed = true;
  await notify();
  expect(changes, 'a failed metadata read must invalidate conservatively').toBe(
    3,
  );
  failed = false;
  await notify();
  await notify();
  expect(changes, 'a successful read reestablishes the baseline').toBe(4);
});
