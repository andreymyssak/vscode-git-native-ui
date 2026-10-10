import { expect, test } from 'vitest';

import { checkSummary } from '../../scripts/test/check-summary.ts';

const runUrl = 'https://github.com/example/project/actions/runs/1';
const summarize = (results: unknown) =>
  checkSummary({ title: 'Extension checks', results, runUrl });

test('a later native failure makes the overall report fail even when local tests passed', () => {
  const result = summarize([
    { name: 'Local tests', status: 'success' },
    { name: 'VS Code tests', status: 'failure' },
    { name: 'Installed tests', status: 'skipped' },
  ]);

  expect(result.status).toBe('failure');
  expect(result.markdown).toContain('Overall: Failed');
  expect(result.markdown).toContain('| Local tests | Passed |');
  expect(result.markdown).toContain('| VS Code tests | Failed |');
  expect(result.markdown).toContain('| Installed tests | Skipped |');
  expect(result.markdown).toContain(
    `[View jobs, logs and artifacts](${runUrl})`,
  );
});

test.each([
  ['success', 'success', 'Passed'],
  ['cancelled', 'cancelled', 'Cancelled'],
  ['skipped', 'skipped', 'Incomplete'],
])(
  'a %s check produces an honest overall status',
  (status, expected, label) => {
    const result = summarize([{ name: 'Browser tests', status }]);

    expect(result.status).toBe(expected);
    expect(result.markdown).toContain(`Overall: ${label}`);
  },
);

test.each([
  { results: null },
  { results: [] },
  { results: [{}] },
  { results: [{ name: 'Native tests', status: 'unknown' }] },
])(
  'missing or invalid check results cannot produce a passing report: $results',
  ({ results }) => {
    expect(() => summarize(results)).toThrow(/check/i);
  },
);

test('check labels cannot split the report into extra table rows', () => {
  const result = summarize([
    { name: 'Native | tests\nWindows', status: 'failure' },
  ]);

  expect(result.markdown).toContain('| Native \\| tests Windows | Failed |');
});
