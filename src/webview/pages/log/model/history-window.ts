import type { Range } from '@tanstack/react-virtual';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { RefObject } from 'react';
import { useCallback } from 'react';

import type { CommitRecord } from '@contracts/model';

const boundedRange = (range: Range) =>
  defaultRangeExtractor(range).slice(0, 300);

export function useHistoryWindow(
  element: RefObject<HTMLDivElement | null>,
  commits: readonly CommitRecord[],
  scrollTop: number,
) {
  // TanStack returns a mutable instance; expose fresh snapshots to compiled consumers.
  'use no memo';
  const getItemKey = useCallback(
    (index: number) => commits[index]!.sha,
    [commits],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- This non-compiled adapter returns fresh snapshots, never the mutable instance.
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: commits.length,
    getScrollElement: () => element.current,
    estimateSize: () => 22,
    getItemKey,
    overscan: 20,
    rangeExtractor: boundedRange,
    initialOffset: scrollTop,
  });

  return {
    items: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
  };
}
