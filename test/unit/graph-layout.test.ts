import { expect, test } from 'vitest';

// Assertions ported from Microsoft scmHistory.test.ts, revision 07f806f999227108933c2e30515b26eecc1fda74.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
import { toISCMHistoryItemViewModelArray } from '../../src/vendor/vscode-graph/graph';

const item = (id: string, parentIds: string[]) => ({
  id,
  parentIds,
  subject: '',
  message: '',
});

test('empty input is empty', () =>
  expect(toISCMHistoryItemViewModelArray([])).toStrictEqual([]));
test('linear and merged lanes preserve parents', () => {
  const linear = toISCMHistoryItemViewModelArray([
    item('a', ['b']),
    item('b', ['c']),
    item('c', []),
  ]);

  expect(
    linear.map((row) => row.outputSwimlanes.map((node) => node.id)),
  ).toStrictEqual([['b'], ['c'], []]);
  const merge = toISCMHistoryItemViewModelArray([
    item('a', ['b']),
    item('b', ['c', 'd']),
    item('d', ['c']),
    item('c', []),
  ]);

  expect(
    merge.map((row) => row.outputSwimlanes.map((node) => node.id)),
  ).toStrictEqual([['b'], ['c', 'd'], ['c', 'c'], []]);
});
test('octopus parents retain identities', () => {
  const rows = toISCMHistoryItemViewModelArray([
    item('a', ['b', 'c', 'd']),
    item('b', ['e']),
    item('c', ['e']),
    item('d', ['e']),
    item('e', []),
  ]);

  expect(rows[0]?.outputSwimlanes.map((node) => node.id)).toStrictEqual([
    'b',
    'c',
    'd',
  ]);
  expect(rows.map((row) => row.historyItem.parentIds)).toStrictEqual([
    ['b', 'c', 'd'],
    ['e'],
    ['e'],
    ['e'],
    [],
  ]);
});
