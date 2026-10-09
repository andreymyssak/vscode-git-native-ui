import { expect, test } from 'vitest';

import { fitPaneWidths } from '../../src/webview/pages/log/model/pane-widths';

test('pane fitting retains preferred widths and compact minimums', () => {
  const preferred: [number, number] = [220, 350];

  expect(fitPaneWidths(1280, preferred)).toStrictEqual(preferred);
  expect(fitPaneWidths(620, preferred)).toStrictEqual([150, 220]);
  expect(preferred).toStrictEqual([220, 350]);
});
test('collapsed branches release their width while keeping the details pane bounded', () => {
  const preferred: [number, number] = [280, 350];

  expect(fitPaneWidths(1280, preferred, true)).toStrictEqual([30, 350]);
  expect(fitPaneWidths(620, [280, 600], true)).toStrictEqual([30, 340]);
  expect(preferred).toStrictEqual([280, 350]);
});
