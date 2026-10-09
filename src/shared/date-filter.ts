import type { DateFilter } from './model';
import { isRecord } from './validation';

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function isDateFilter(value: unknown): value is DateFilter {
  if (typeof value === 'string') return ['all', '24h', '7d'].includes(value);
  if (!isRecord(value)) return false;
  const range = value;

  return (
    Object.keys(range).length === 3 &&
    range.kind === 'range' &&
    (range.from === null || isCalendarDate(range.from)) &&
    (range.to === null || isCalendarDate(range.to)) &&
    !!(range.from || range.to) &&
    (range.from === null || range.to === null || range.from <= range.to)
  );
}

export function dateBounds(date: DateFilter, now: number): [number, number] {
  if (date === 'all') return [-Infinity, Infinity];
  if (typeof date === 'string')
    return [now - (date === '24h' ? 1 : 7) * 86400000, Infinity];
  const midnight = (value: string, next: boolean) => {
    const [year, month, day] = value.split('-').map(Number);

    return new Date(year!, month! - 1, day! + (next ? 1 : 0)).getTime();
  };

  // Advancing the calendar day also handles daylight-saving days of 23/25 hours.
  return [
    date.from ? midnight(date.from, false) : -Infinity,
    date.to ? midnight(date.to, true) : Infinity,
  ];
}
