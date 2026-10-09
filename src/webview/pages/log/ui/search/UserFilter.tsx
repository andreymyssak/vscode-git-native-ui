import type { HistoryFilters } from '@contracts/model';

import styles from './Dropdown.module.css';
import { FilterDropdown } from './FilterDropdown';

type AuthorFilter = HistoryFilters['author'];

export function UserFilter({
  author,
  onChange,
  onChoose,
}: {
  author: AuthorFilter;
  onChange(this: void, author: AuthorFilter): void;
  onChoose(this: void): void;
}) {
  const label =
    author.kind === 'all'
      ? 'User'
      : author.kind === 'me'
        ? 'Me'
        : author.identities.length === 1
          ? author.identities[0]!.name || author.identities[0]!.email
          : `${author.identities.length} users`;

  return (
    <FilterDropdown
      id="author-filter"
      name="User"
      label={label}
      active={author.kind !== 'all'}
      panelLabel="Filter by user"
      onClear={() => onChange({ kind: 'all' })}
    >
      {(close) => (
        <div className={styles.options}>
          <button
            type="button"
            onClick={() => {
              close();
              onChoose();
            }}
          >
            Select users…
          </button>
          <button
            type="button"
            aria-pressed={author.kind === 'me'}
            onClick={() => {
              onChange({ kind: 'me' });
              close();
            }}
          >
            Me
          </button>
        </div>
      )}
    </FilterDropdown>
  );
}
