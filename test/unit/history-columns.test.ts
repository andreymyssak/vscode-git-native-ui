import { expect, test } from 'vitest';

import {
  fitColumns,
  resizeVisibleColumns,
} from '../../src/webview/pages/log/model/history-columns';

test('fitted columns adapt excessive preferences without mutating them', () => {
  const preferred: [number, number] = [900, 800];
  const fit = fitColumns(400, 200, preferred);

  expect(fit[0]).toBe(200);
  expect(fit[1]).toBeGreaterThanOrEqual(65);
  expect(fit[2]).toBeGreaterThanOrEqual(80);
  expect(fit.reduce((a, b) => a + b, 0)).toBe(400);
  expect(preferred).toStrictEqual([900, 800]);
  expect(resizeVisibleColumns([400, 100, 130, 0], 200, 0, 1, 40)).toStrictEqual(
    [435, 65, 130, 0],
  );
  expect(resizeVisibleColumns([400, 100, 130, 0], 200, 1, 2, 60)).toStrictEqual(
    [400, 150, 80, 0],
  );
});
test('hidden metadata columns release space while visible columns retain their minimum widths', () => {
  expect(
    fitColumns(500, 200, [100, 130], { author: false, date: true }),
  ).toStrictEqual([370, 0, 130]);
  expect(
    fitColumns(500, 200, [100, 130], { author: true, date: false }),
  ).toStrictEqual([400, 100, 0]);
  expect(
    fitColumns(500, 200, [100, 130], { author: false, date: false }),
  ).toStrictEqual([500, 0, 0]);
  expect(
    fitColumns(180, 200, [100, 130], { author: false, date: false }),
  ).toStrictEqual([200, 0, 0]);
});
