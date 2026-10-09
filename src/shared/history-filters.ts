import { isDateFilter } from './date-filter';
import type { AuthorIdentity, HistoryFilters } from './model';
import { isRecord } from './validation';

function exactKeys(value: Record<string, unknown>, names: string[]): boolean {
  return (
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  );
}

function isIdentity(value: unknown): value is AuthorIdentity {
  if (!isRecord(value) || !exactKeys(value, ['name', 'email'])) return false;

  return (
    [value.name, value.email].every(
      (field) =>
        typeof field === 'string' &&
        field.length <= 512 &&
        !field.includes('\0'),
    ) && !!(value.name || value.email)
  );
}

export function isHistoryFilters(value: unknown): value is HistoryFilters {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['regex', 'matchCase', 'author', 'date']) ||
    typeof value.regex !== 'boolean' ||
    typeof value.matchCase !== 'boolean' ||
    !isDateFilter(value.date) ||
    !isRecord(value.author)
  )
    return false;
  const author = value.author;

  if (author.kind === 'all' || author.kind === 'me')
    return exactKeys(author, ['kind']);

  return (
    author.kind === 'selected' &&
    exactKeys(author, ['kind', 'identities']) &&
    Array.isArray(author.identities) &&
    author.identities.length > 0 &&
    author.identities.length <= 100 &&
    author.identities.every(isIdentity)
  );
}

export function normalizeHistoryFilters(
  value?: HistoryFilters,
): HistoryFilters {
  if (value === undefined)
    value = {
      regex: false,
      matchCase: false,
      author: { kind: 'all' },
      date: 'all',
    };
  if (!isHistoryFilters(value)) throw new Error('Invalid history filters.');
  const author = value.author;

  return {
    regex: value.regex,
    matchCase: value.matchCase,
    date: typeof value.date === 'object' ? { ...value.date } : value.date,
    author:
      author.kind === 'selected'
        ? {
            kind: 'selected',
            identities: [
              ...new Map(
                author.identities.map((item) => [
                  JSON.stringify(item),
                  { ...item },
                ]),
              ).values(),
            ].sort(
              (a, b) =>
                a.email.localeCompare(b.email) || a.name.localeCompare(b.name),
            ),
          }
        : { kind: author.kind },
  };
}
