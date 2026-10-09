import { useEffect, useRef } from 'react';

import styles from './SplitHandle.module.css';

interface Props {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  direction: 1 | -1;
  onChange(this: void, value: number): void;
}

export function SplitHandle({
  id,
  label,
  value,
  min,
  max,
  direction,
  onChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; value: number } | null>(null);
  const end = () => {
    const active = drag.current;

    drag.current = null;
    if (active && ref.current?.hasPointerCapture(active.id))
      ref.current.releasePointerCapture(active.id);
  };

  useEffect(
    () => () => {
      const active = drag.current;

      drag.current = null;
      if (active && ref.current?.hasPointerCapture(active.id))
        ref.current.releasePointerCapture(active.id);
    },
    [],
  );
  const change = (next: number) => onChange(Math.max(min, Math.min(max, next)));

  return (
    <div
      ref={ref}
      id={id}
      className={styles.handle}
      tabIndex={0}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        end();
        drag.current = { id: event.pointerId, x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = drag.current;

        if (active?.id === event.pointerId)
          change(active.value + (event.clientX - active.x) * direction);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          change(value + (event.key === 'ArrowRight' ? 10 : -10) * direction);
        }
      }}
    />
  );
}
