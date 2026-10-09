import { expect, test } from 'vitest';

import {
  readSaved,
  restoreView,
} from '../../src/webview/app/model/persistence';

test('recreated panel validates saved identifiers and removed roots', () => {
  const repo = {
    id: 'one',
    label: 'One',
    rootUri: 'file:///one',
    headSha: null,
    branch: null,
  };
  const saved = {
    repositoryId: 'one',
    activeView: 'worktrees',
    scope: { kind: 'ref', refId: 'refs/heads/topic' },
    text: 'find',
    selectedRefId: null,
    selection: { sha: 'a'.repeat(40), parentSha: null, filePath: 'safe.txt' },
    anchor: { sha: 'a'.repeat(40), offset: 5 },
    paneWidths: [270, 450],
  };

  expect(restoreView(saved, [repo])).toStrictEqual({
    ...saved,
    branchesCollapsed: false,
    historyColumnWidths: null,
    filters: {
      regex: false,
      matchCase: false,
      author: { kind: 'all' },
      date: 'all',
    },
    showHash: false,
    hashColumnWidth: 100,
    presentation: {
      showAuthor: true,
      showDate: true,
      highlightMyCommits: true,
      highlightMergeCommits: true,
      highlightCurrentBranch: true,
    },
  });
  const missing = restoreView(saved, []) as typeof saved;

  expect(missing.repositoryId).toBe(null);
  expect(missing.selection).toBe(null);
  const malformed = restoreView(
    {
      repositoryId: 'one',
      selection: { sha: '--force' },
      paneWidths: [NaN, 1e20],
    },
    [repo],
  ) as typeof saved;

  expect(malformed.selection).toBe(null);
  expect(malformed.paneWidths).toStrictEqual([220, 350]);
});
test('branch visibility is saved without replacing the expanded pane width', () => {
  const saved = { branchesCollapsed: true, paneWidths: [280, 360] };

  expect(readSaved(saved).branchesCollapsed).toBe(true);
  expect(restoreView(saved, []).branchesCollapsed).toBe(true);
  expect(readSaved(saved).paneWidths).toStrictEqual([280, 360]);
  expect(
    readSaved({ ...saved, branchesCollapsed: 'true' }).branchesCollapsed,
  ).toBe(false);
});
test('saved filters and revision options preserve valid values and discard malformed inputs', () => {
  const filters = {
    regex: true,
    matchCase: true,
    author: {
      kind: 'selected',
      identities: [{ name: 'Alice', email: 'alice@example.test' }],
    },
    date: '7d',
  };
  const view = readSaved({
    filters,
    showHash: true,
    hashColumnWidth: 135,
    historyColumnWidths: [180, 220],
  });

  expect(view.filters).toStrictEqual(filters);
  expect(view.showHash).toBe(true);
  expect(view.hashColumnWidth).toBe(135);
  expect(view.historyColumnWidths).toStrictEqual([180, 220]);
  for (const invalid of [
    { ...filters, author: { kind: 'selected', identities: [] } },
    { ...filters, regex: 'true' },
    { ...filters, date: '--all' },
  ]) {
    expect(readSaved({ filters: invalid }).filters).toStrictEqual({
      regex: false,
      matchCase: false,
      author: { kind: 'all' },
      date: 'all',
    });
  }

  for (const width of [64, NaN, Infinity, 10001, '135'])
    expect(readSaved({ hashColumnWidth: width }).hashColumnWidth).toBe(100);
  expect(readSaved({ showHash: 'true' }).showHash).toBe(false);
});
test('saved column widths validate both metadata columns and survive removed roots', () => {
  const saved = {
    repositoryId: 'removed',
    historyColumnWidths: [180, 220],
  };

  expect(readSaved(saved).historyColumnWidths).toStrictEqual([180, 220]);
  expect(restoreView(saved, []).historyColumnWidths).toStrictEqual([180, 220]);
  for (const widths of [
    [64, 220],
    [180, 79],
    [NaN, 220],
    [180, Infinity],
    [1e20, 220],
    [180],
  ])
    expect(
      readSaved({ ...saved, historyColumnWidths: widths }).historyColumnWidths,
    ).toBe(null);
});
test('column visibility and highlights survive missing roots and normalize malformed preferences', () => {
  const presentation = {
    showAuthor: false,
    showDate: false,
    highlightMyCommits: false,
    highlightMergeCommits: false,
    highlightCurrentBranch: false,
  };

  expect(
    restoreView({ repositoryId: 'gone', presentation }, []).presentation,
  ).toStrictEqual(presentation);
  expect(
    readSaved({
      presentation: { ...presentation, showAuthor: 'false', showDate: null },
    }).presentation,
  ).toStrictEqual({ ...presentation, showAuthor: true, showDate: true });
});
