import { expect, test } from 'vitest';

import type { CommitRecord } from '../../src/shared/model';
import { GraphAdapter } from '../../src/webview/pages/log/lib/graph/adapter';

const commit = (sha: string, parents: string[]): CommitRecord => ({
  sha,
  parents,
  message: sha,
  authorName: null,
  authorEmail: null,
  authorDate: null,
  commitDate: null,
});

test('page continuation keeps exact parent identities', () => {
  const rows = new GraphAdapter().layout(
    [commit('a', ['b']), commit('b', ['c'])],
    'history',
  );

  expect(rows.length).toBe(2);
  expect(
    rows[1]?.viewModel.inputSwimlanes.map((node) => node.id),
  ).toStrictEqual(['b']);
  expect(
    rows[1]?.viewModel.outputSwimlanes.map((node) => node.id),
  ).toStrictEqual(['c']);
  expect(rows[1]?.missingParents).toStrictEqual(['c']);
});
test('search connects only direct parents present without changing operation records', () => {
  const commits = [
    commit('a', ['missing']),
    commit('b', ['c']),
    commit('c', []),
  ];
  const rows = new GraphAdapter().layout(commits, 'search');

  expect(rows.length).toBe(3);
  expect(rows[0]?.viewModel.historyItem.parentIds).toStrictEqual([]);
  expect(rows[1]?.viewModel.historyItem.parentIds).toStrictEqual(['c']);
  expect(commits[0]?.parents).toStrictEqual(['missing']);
});
test('the actual checkout has the HEAD ring without changing parent lanes', () => {
  const commits = [
    commit('a', ['b', 'c']),
    commit('b', ['c']),
    commit('c', []),
  ];
  const adapter = new GraphAdapter();
  const ordinary = adapter.layout(commits, 'history');
  const checkout = adapter.layout(commits, 'history', 'b');

  expect(checkout.map((row) => row.viewModel.kind)).toStrictEqual([
    'node',
    'HEAD',
    'node',
  ]);
  expect(
    checkout.map((row) => [
      row.viewModel.inputSwimlanes,
      row.viewModel.outputSwimlanes,
    ]),
  ).toStrictEqual(
    ordinary.map((row) => [
      row.viewModel.inputSwimlanes,
      row.viewModel.outputSwimlanes,
    ]),
  );
  expect(checkout[0]?.viewModel.historyItem.parentIds).toStrictEqual([
    'b',
    'c',
  ]);
});
test('filtered history never labels its first result as a missing HEAD', () => {
  const rows = new GraphAdapter().layout(
    [commit('a', ['b']), commit('b', [])],
    'search',
    'outside',
  );

  expect(rows.map((row) => row.viewModel.kind)).toStrictEqual(['node', 'node']);
});
