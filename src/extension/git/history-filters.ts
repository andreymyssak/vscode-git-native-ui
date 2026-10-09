import { dateBounds } from '../../shared/date-filter';
import type { AuthorIdentity, HistoryFilters } from '../../shared/model';
import { classifySearch } from '../../shared/search';
import { isRecord } from '../../shared/validation';
import type { GitCli } from './cli';
import { readUserIdentity } from './identity';

interface Entry {
  sha: string;
  author: AuthorIdentity;
  committedAt: number;
}

async function entries(
  cli: GitCli,
  id: string,
  tips: string[],
  signal?: AbortSignal,
): Promise<Entry[]> {
  if (!tips.length) return [];
  const fields = (
    await cli.run(
      id,
      [
        'log',
        '--topo-order',
        '--format=%H%x00%an%x00%ae%x00%ct%x00',
        ...tips,
        '--',
      ],
      signal,
    )
  ).split('\0');
  const result: Entry[] = [];

  for (let index = 0; index + 3 < fields.length; index += 4) {
    const sha = fields[index]!.trim();
    const committedAt = Number(fields[index + 3]) * 1000;

    if (
      !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha) ||
      !Number.isFinite(committedAt)
    )
      throw new Error('Git returned an invalid history identity.');
    result.push({
      sha,
      author: { name: fields[index + 1]!, email: fields[index + 2]! },
      committedAt,
    });
  }

  return result;
}

export async function readAuthors(
  cli: GitCli,
  id: string,
  tips: string[],
  signal?: AbortSignal,
): Promise<AuthorIdentity[]> {
  const authors = new Map<string, AuthorIdentity>();

  for (const entry of await entries(cli, id, tips, signal)) {
    const identity = entry.author;

    if (identity.name || identity.email)
      authors.set(JSON.stringify(identity), identity);
  }

  return [...authors.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email),
  );
}

async function chosenAuthors(
  cli: GitCli,
  id: string,
  filters: HistoryFilters,
  signal?: AbortSignal,
): Promise<AuthorIdentity[] | null> {
  if (filters.author.kind === 'all') return null;
  if (filters.author.kind === 'selected') return filters.author.identities;
  const user = await readUserIdentity(cli, id, signal);

  if (user) return [user];
  throw new Error(
    'Configure your Git identity (user.email or user.name) to use Me.',
  );
}

export async function filteredHistoryOrder(
  cli: GitCli,
  id: string,
  tips: string[],
  text: string,
  filters: HistoryFilters,
  now: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const authors = await chosenAuthors(cli, id, filters, signal);

  signal?.throwIfAborted();
  const [from, until] = dateBounds(filters.date, now);
  const order = (await entries(cli, id, tips, signal))
    .filter(
      (entry) =>
        entry.committedAt >= from &&
        entry.committedAt < until &&
        (authors === null ||
          authors.some((author) =>
            author.email
              ? author.email === entry.author.email
              : author.name === entry.author.name,
          )),
    )
    .map((entry) => entry.sha);

  if (!text || !tips.length) return order;
  let matches: string;

  try {
    matches = await cli.run(
      id,
      [
        'log',
        '--topo-order',
        '--format=%H',
        filters.regex ? '--extended-regexp' : '--fixed-strings',
        ...(filters.matchCase ? [] : ['--regexp-ignore-case']),
        `--grep=${text}`,
        ...tips,
        '--',
      ],
      signal,
    );
  } catch (error) {
    if (
      filters.regex &&
      /Unmatched|Invalid.*regexp|Invalid.*regular|invalid.*expression/i.test(
        String(
          isRecord(error) && typeof error.stderr === 'string'
            ? error.stderr
            : error,
        ),
      )
    )
      throw new Error(
        'Invalid regular expression. Check the pattern and try again.',
        { cause: error },
      );
    throw error;
  }

  const messages = new Set(matches.trim().split('\n').filter(Boolean));
  const hash =
    !filters.regex && classifySearch(text) === 'hash-and-text'
      ? text.toLowerCase()
      : null;

  return order.filter(
    (sha) =>
      messages.has(sha) ||
      (hash !== null && sha.toLowerCase().startsWith(hash)),
  );
}
