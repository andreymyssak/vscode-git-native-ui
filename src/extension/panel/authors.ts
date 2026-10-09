import { normalizeHistoryFilters } from '../../shared/history-filters';
import type { PanelBody, Request } from '../../shared/messages';
import type { AuthorIdentity, HistoryInput } from '../../shared/model';
import type { GitAdapter } from '../git/adapter';
import type { QuerySession } from './queries';

export type AuthorPicker = (
  authors: AuthorIdentity[],
  selected: AuthorIdentity[],
  signal: AbortSignal,
) => Promise<AuthorIdentity[] | null>;

/** A picker belongs to its captured query even if the native dialog outlives it. */
export async function chooseHistoryAuthors(
  adapter: GitAdapter,
  session: QuerySession,
  request: Request<unknown>,
  query: HistoryInput,
  pick?: AuthorPicker,
): Promise<Extract<PanelBody, { kind: 'notice' | 'filters' }> | null> {
  const signal = session.abort.signal;
  const current = () =>
    session.current(request.repositoryId, request.generation);
  const authors = await adapter.authors(request.repositoryId, signal);

  if (!current()) return null;
  if (!authors.length)
    return {
      kind: 'notice',
      message: 'No commit authors are available in this repository.',
    };
  const filters = normalizeHistoryFilters(query.filters);
  const selected = await pick?.(
    authors,
    filters.author.kind === 'selected' ? filters.author.identities : [],
    signal,
  );

  if (!selected || !current()) return null;
  if (
    selected.length > 100 ||
    selected.some(
      (identity) =>
        !authors.some(
          (author) =>
            author.name === identity.name && author.email === identity.email,
        ),
    )
  )
    throw new Error('Choose up to 100 authors from this repository.');

  return {
    kind: 'filters',
    filters: normalizeHistoryFilters({
      ...filters,
      author: selected.length
        ? { kind: 'selected', identities: selected }
        : { kind: 'all' },
    }),
  };
}
