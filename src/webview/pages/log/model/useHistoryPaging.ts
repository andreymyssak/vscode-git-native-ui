import { useEffect, useRef } from 'react';

import type { LogData, LogIntent } from './view';

export function useHistoryPaging(
  data: LogData,
  viewportHeight: number,
  onIntent: (intent: LogIntent) => void,
) {
  const ownership = useRef({ key: '', requested: new Set<string>() });

  useEffect(() => {
    const key = `${data.repository?.id ?? ''}:${data.generation}`;

    if (ownership.current.key !== key)
      ownership.current = { key, requested: new Set() };
    const cursor = data.nextCursor;

    if (
      !cursor ||
      data.loading ||
      !data.repository ||
      !data.commits.length ||
      viewportHeight <= 0 ||
      data.scrollTop + viewportHeight <
        data.commits.length * 22 - Math.max(66, viewportHeight) ||
      ownership.current.requested.has(cursor)
    )
      return;
    ownership.current.requested.add(cursor);
    onIntent({
      kind: 'request',
      body: {
        kind: 'history',
        scope: data.scope,
        text: data.text,
        filters: data.filters,
        cursor,
      },
    });
  }, [
    data.repository,
    data.generation,
    data.nextCursor,
    data.loading,
    data.commits.length,
    data.scrollTop,
    data.scope,
    data.text,
    data.filters,
    viewportHeight,
    onIntent,
  ]);
}
