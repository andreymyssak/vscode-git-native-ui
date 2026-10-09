import { expect, test } from 'vitest';

import { dateBounds } from '../../src/shared/date-filter';
import {
  isHistoryFilters,
  normalizeHistoryFilters,
} from '../../src/shared/history-filters';
import { readSaved } from '../../src/webview/app/model/persistence';

const range = { kind: 'range', from: '2024-02-29', to: '2024-03-01' };

test.each([
  ['leap day', range, true],
  ['open start', { ...range, from: null }, true],
  ['open end', { ...range, to: null }, true],
  ['single day', { ...range, to: range.from }, true],
  ['invalid leap day', { ...range, from: '2023-02-29' }, false],
  ['invalid month', { ...range, to: '2024-13-01' }, false],
  ['reversed range', { ...range, from: '2024-03-02' }, false],
  ['empty range', { ...range, from: null, to: null }, false],
  ['non-date value', { ...range, to: '--all' }, false],
  ['unknown property', { ...range, timezone: 'UTC' }, false],
])('calendar range validates %s', (_name, date, valid) => {
  expect(isHistoryFilters({ ...normalizeHistoryFilters(), date })).toBe(valid);
});

test('a valid calendar range survives saved filter validation', () => {
  expect(
    readSaved({
      filters: { ...normalizeHistoryFilters(), date: range },
    }).filters?.date,
  ).toStrictEqual(range);
});

test.each([
  ['2026-03-08', 23],
  ['2026-11-01', 25],
] as const)(
  'inclusive local day %s spans %i hours across daylight saving',
  (day, hours) => {
    const previous = process.env.TZ;

    process.env.TZ = 'America/New_York';
    try {
      const [from, until] = dateBounds(
        { kind: 'range', from: day, to: day },
        0,
      );

      expect(until - from).toBe(hours * 3600000);
      expect(new Date(from).getHours()).toBe(0);
      expect(new Date(until).getHours()).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  },
);
