import { expect, test } from 'vitest';

import {
  selectCommitRange,
  singleCommitRange,
} from '../../src/webview/pages/log/model';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const d = 'd'.repeat(40);
const order = [a, b, c, d];

test('Shift reverses the displayed endpoint without moving its anchor', () => {
  const initial = singleCommitRange(b);
  const down = selectCommitRange(initial, order, d, 'extend');

  expect(down).toStrictEqual({
    selectedShas: [b, c, d],
    activeSha: d,
    anchorSha: b,
  });
  const reversed = selectCommitRange(down, order, a, 'extend');

  expect(reversed).toStrictEqual({
    selectedShas: [a, b],
    activeSha: a,
    anchorSha: b,
  });
  expect(initial.selectedShas).toStrictEqual([b]);
});

test('context inside a range preserves members while an outside or plain gesture selects one', () => {
  const range = selectCommitRange(singleCommitRange(b), order, d, 'extend');
  const inside = selectCommitRange(range, order, c, 'context');

  expect(inside).toStrictEqual({
    selectedShas: [b, c, d],
    activeSha: c,
    anchorSha: b,
  });
  expect(selectCommitRange(inside, order, a, 'context')).toStrictEqual({
    selectedShas: [a],
    activeSha: a,
    anchorSha: a,
  });
  expect(selectCommitRange(inside, order, c, 'plain')).toStrictEqual({
    selectedShas: [c],
    activeSha: c,
    anchorSha: c,
  });
});

test.each([
  ['missing', null, order, c],
  ['removed', a, [b, c, d], d],
] as const)(
  'a %s anchor starts a single loaded selection',
  (_name, anchor, loaded, target) => {
    expect(
      selectCommitRange(singleCommitRange(anchor), loaded, target, 'extend'),
    ).toStrictEqual({
      selectedShas: [target],
      activeSha: target,
      anchorSha: target,
    });
  },
);

test.each(['plain', 'extend', 'context'] as const)(
  '%s ignores unknown identities and empty results',
  (gesture) => {
    const range = singleCommitRange(b);

    expect(selectCommitRange(range, order, 'f'.repeat(40), gesture)).toBe(
      range,
    );
    expect(selectCommitRange(range, [], a, gesture)).toBe(range);
  },
);
