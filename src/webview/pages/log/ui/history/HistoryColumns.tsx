import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import type {
  ColumnIndex,
  Columns,
  ColumnWidths,
  MetadataWidths,
} from '../../model/history-columns';
import { resizeVisibleColumns } from '../../model/history-columns';
import styles from './HistoryPane.module.css';

interface Props {
  columns: Columns;
  preferred: [number, number];
  defaults: [number, number];
  minimum: number;
  width: number;
  height: number;
  top: number;
  scrollLeft: number;
  onChange(this: void, widths: MetadataWidths): void;
  revisionWidth?: number;
  onRevisionChange(
    this: void,
    width: number,
    metadata?: [number, number],
  ): void;
}

export function HistoryColumns({
  columns,
  preferred,
  defaults,
  minimum,
  width,
  height,
  top,
  scrollLeft,
  onChange,
  revisionWidth = 0,
  onRevisionChange,
}: Props) {
  const drag = useRef<{
    left: ColumnIndex;
    right: ColumnIndex;
    id: number;
    x: number;
    widths: ColumnWidths;
    handle: HTMLDivElement;
  } | null>(null);
  const [active, setActive] = useState<ColumnIndex | null>(null);
  const release = () => {
    const current = drag.current;

    drag.current = null;
    if (current?.handle.hasPointerCapture(current.id))
      current.handle.releasePointerCapture(current.id);
  };

  const end = () => {
    release();
    setActive(null);
  };

  useEffect(() => () => release(), []);
  const widths: ColumnWidths = [...columns, revisionWidth];
  const visible = ([0, 1, 2, 3] as const).filter((index) => widths[index] > 0);
  const names = ['Commit', 'Author', 'Date', 'Revision'];
  const minima = [minimum, 65, 80, 65];
  const resize = (
    values: ColumnWidths,
    left: ColumnIndex,
    right: ColumnIndex,
    delta: number,
  ) => {
    const next = resizeVisibleColumns(values, minimum, left, right, delta);
    const metadata: [number, number] = [
      next[1] || preferred[0],
      next[2] || preferred[1],
    ];

    if (right === 3) onRevisionChange(next[3], metadata);
    else onChange(metadata);
  };

  return (
    <div
      data-history-column-handles=""
      className={styles['history-column-handles']}
      style={{ top, height, width }}
    >
      {visible.slice(0, -1).map((left, index) => {
        const right = visible[index + 1]!;
        const position =
          widths.slice(0, left + 1).reduce((sum, value) => sum + value, 0) -
          scrollLeft;
        const value = widths[left];
        const min = Math.max(minima[left]!, value + widths[right] - 10000);
        const max = Math.min(
          left === 0 ? Infinity : 10000,
          value + widths[right] - minima[right]!,
        );

        return (
          <div
            key={left}
            data-history-column-resizer=""
            className={clsx(
              styles['history-column-resizer'],
              active === left && styles.dragging,
            )}
            style={{ left: position - 2.5 }}
            hidden={position < 3 || position > width - 3}
            role="separator"
            tabIndex={0}
            aria-label={`Resize ${names[left]} and ${names[right]} columns`}
            aria-orientation="vertical"
            aria-valuenow={Math.round(value)}
            aria-valuemin={Math.round(min)}
            aria-valuemax={Math.round(max)}
            aria-valuetext={`${Math.round(value)} pixels`}
            title="Drag to resize columns. Double-click to reset widths."
            onDoubleClick={() => {
              if (right === 3) onRevisionChange(100);
              else if (!columns[1]) onChange([preferred[0], defaults[1]]);
              else if (!columns[2]) onChange([defaults[0], preferred[1]]);
              else onChange(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                resize(
                  widths,
                  left,
                  right,
                  event.key === 'ArrowRight' ? 10 : -10,
                );
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return;
              event.preventDefault();
              end();
              drag.current = {
                left,
                right,
                id: event.pointerId,
                x: event.clientX,
                widths,
                handle: event.currentTarget,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              setActive(left);
            }}
            onPointerMove={(event) => {
              const current = drag.current;

              if (current?.id === event.pointerId)
                resize(
                  current.widths,
                  current.left,
                  current.right,
                  event.clientX - current.x,
                );
            }}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
          />
        );
      })}
    </div>
  );
}
