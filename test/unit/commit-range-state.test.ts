import { expect, test } from 'vitest';

import type { PanelBody } from '../../src/shared/messages';
import type { CommitRecord } from '../../src/shared/model';
import type { ViewState } from '../../src/webview/app/model/state';
import { initialView, reduceView } from '../../src/webview/app/model/state';
import { canSquashLoadedRange } from '../../src/webview/pages/log/model/commit-action-hints';

const a = 'a'.repeat(40);

const b = 'b'.repeat(40);

const c = 'c'.repeat(40);

const d = 'd'.repeat(40);

const commits: CommitRecord[] = [a, b, c, d].map((sha, index) => ({
  sha,
  parents: index === 3 ? [] : [[b, c, d][index]!],
  message: 'Commit ' + sha[0],
  authorName: 'Author',
  authorEmail: 'author@example.test',
  authorDate: null,
  commitDate: null,
}));

const repository = {
  id: 'one',
  label: 'One',
  rootUri: 'file:///one',
  branch: 'main',
  headSha: a,
};

function host(body: PanelBody, generation = 1, repositoryId = 'one') {
  return {
    kind: 'host' as const,
    message: { requestId: 'fixture', repositoryId, generation, body },
  };
}

function history(rows: CommitRecord[], append = false, target = repository) {
  return {
    kind: 'history' as const,
    repository: target,
    scope: { kind: 'head' as const },
    text: '',
    append,
    page: { commits: rows, refs: [], nextCursor: null, scopeId: 'fixture' },
  };
}

function selectedRange() {
  let state: ViewState = {
    ...initialView(),
    repository,
    commits,
    generation: 1,
  };

  state = reduceView(state, { kind: 'select-commit', sha: b });

  return reduceView(state, {
    kind: 'select-commit',
    sha: d,
    gesture: 'extend',
  });
}

test('Shift without a valid anchor starts a single loaded selection and ignores stale identities', () => {
  const state = { ...initialView(), repository, commits };
  const selected = reduceView(state, {
    kind: 'select-commit',
    sha: c,
    gesture: 'extend',
  });

  expect(selected.commitRange).toEqual({
    selectedShas: [c],
    activeSha: c,
    anchorSha: c,
  });
  expect(
    reduceView(selected, { kind: 'select-commit', sha: 'f'.repeat(40) }),
  ).toBe(selected);
});

test('scroll, reference refresh and appended history retain the selected identities without extending the range', () => {
  const selected = selectedRange();
  const scrolled = reduceView(selected, {
    kind: 'update',
    patch: { scrollTop: 44 },
  });

  expect(scrolled.commitRange).toBe(selected.commitRange);
  const references = reduceView(
    scrolled,
    host({ kind: 'references', references: [] }),
  );

  expect(references.commitRange).toBe(selected.commitRange);
  const appended = reduceView(
    references,
    host(history([{ ...commits[0]!, sha: 'e'.repeat(40) }], true)),
  );

  expect(appended.commitRange.selectedShas).toEqual([b, c, d]);
  expect(appended.commits).toHaveLength(5);
});

test('reference-only updates replace squash hints without disturbing the range, active details or selected file', () => {
  let selected: ViewState = {
    ...initialView(),
    repository,
    commits,
    generation: 1,
  };

  selected = reduceView(selected, { kind: 'select-commit', sha: a });
  selected = reduceView(selected, {
    kind: 'select-commit',
    sha: b,
    gesture: 'extend',
  });
  selected = {
    ...selected,
    refs: [
      {
        id: 'refs/remotes/origin/main',
        name: 'origin/main',
        kind: 'remote',
        remote: 'origin',
        sha: a,
      },
    ],
    details: commits[1]!,
    files: {
      [c]: [
        {
          id: 'owned-file',
          status: 'modified',
          newPath: 'thing.ts',
          oldPath: 'thing.ts',
        },
      ],
    },
    selectedParentSha: c,
    selectedFilePath: 'thing.ts',
  };
  expect(canSquashLoadedRange(selected)).toBe(false);
  const refreshed = reduceView(
    selected,
    host({ kind: 'references', references: [] }),
  );

  expect(refreshed.refs).toEqual([]);
  expect(canSquashLoadedRange(refreshed)).toBe(true);
  expect(refreshed.commitRange).toBe(selected.commitRange);
  expect(refreshed.selectedSha).toBe(b);
  expect(refreshed.details).toBe(selected.details);
  expect(refreshed.files).toBe(selected.files);
  expect(refreshed.selectedParentSha).toBe(c);
  expect(refreshed.selectedFilePath).toBe('thing.ts');
  expect(
    reduceView(selected, host({ kind: 'references', references: [] }, 0)),
  ).toBe(selected);
  expect(
    reduceView(
      selected,
      host({ kind: 'references', references: [] }, 1, 'two'),
    ),
  ).toBe(selected);
});

test('replacement and refresh retain at most one valid active row and filters clear selection', () => {
  const selected = selectedRange();

  expect(reduceView(selected, host(history(commits))).commitRange).toEqual({
    selectedShas: [d],
    activeSha: d,
    anchorSha: d,
  });
  const refresh = reduceView(
    selected,
    host(
      {
        kind: 'loading',
        repository,
        scope: { kind: 'head' },
        text: '',
        preserve: true,
      },
      2,
    ),
  );

  expect(refresh.commitRange.selectedShas).toEqual([]);
  expect(
    reduceView(refresh, host(history(commits), 2)).commitRange.selectedShas,
  ).toEqual([d]);
  const removed = reduceView(selected, host(history(commits.slice(0, 3))));

  expect(removed.selectedSha).toBeNull();
  expect(removed.commitRange.selectedShas).toEqual([]);
  expect(
    reduceView(selected, { kind: 'apply-scope', scope: { kind: 'all' } })
      .commitRange.selectedShas,
  ).toEqual([]);
});

test('a new query or repository never appends stale history or keeps its range', () => {
  const selected = selectedRange();
  const nextQuery = reduceView(selected, host(history([commits[0]!], true), 2));

  expect(nextQuery.commits.map((commit) => commit.sha)).toEqual([a]);
  expect(nextQuery.commitRange.selectedShas).toEqual([]);
  const otherRepository = { ...repository, id: 'two', rootUri: 'file:///two' };
  const switched = reduceView(
    selected,
    host(history(commits, true, otherRepository), 2, 'two'),
  );

  expect(switched.commitRange.selectedShas).toEqual([]);
  expect(switched.selectedSha).toBeNull();
});

test('Go To and restored selection cannot retain identities outside the loaded result', () => {
  const selected = selectedRange();
  const revealed = reduceView(selected, host({ kind: 'reveal', sha: a }));

  expect(revealed.commitRange).toEqual({
    selectedShas: [a],
    activeSha: a,
    anchorSha: a,
  });
  const invalid = 'f'.repeat(40);

  expect(reduceView(selected, host({ kind: 'reveal', sha: invalid }))).toBe(
    selected,
  );
  const reconciled = reduceView(
    selected,
    host({
      kind: 'selection',
      sha: invalid,
      parentSha: null,
      filePath: null,
      anchor: null,
    }),
  );

  expect(reconciled.selectedSha).toBeNull();
  expect(reconciled.commitRange.selectedShas).toEqual([]);
});
