import {
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { useState } from 'react';

import type { HistoryPresentation } from '@contracts/model';
import { Icon } from '@webview/shared/ui';

import styles from './HistoryToolbar.module.css';

export function ColumnOptions({
  showHash,
  onChange,
  presentation,
  onPresentationChange,
}: {
  showHash: boolean;
  onChange(this: void, show: boolean): void;
  presentation: HistoryPresentation;
  onPresentationChange(this: void, presentation: HistoryPresentation): void;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'right-start',
    strategy: 'fixed',
    middleware: [offset(8), flip(), shift({ padding: 8, crossAxis: true })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { handleClose: safePolygon() }),
    useClick(context, { toggle: false }),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);

  return (
    <>
      <button
        ref={(node) => refs.setReference(node)}
        {...getReferenceProps({
          onKeyDown(event) {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              setOpen(true);
              requestAnimationFrame(() =>
                refs.floating.current?.querySelector('input')?.focus(),
              );
            }
          },
        })}
        className={styles.columns}
        aria-label="Columns"
      >
        Columns <Icon name="chevron-right" />
      </button>
      {open && (
        <div
          ref={(node) => refs.setFloating(node)}
          {...getFloatingProps({
            onKeyDown(event) {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setOpen(false);
                const reference = refs.domReference.current;

                if (reference instanceof HTMLElement) reference.focus();
              }
            },
          })}
          className={`${styles.options} ${styles.submenu}`}
          style={floatingStyles}
          role="group"
          aria-label="Columns"
        >
          <label>
            <input
              type="checkbox"
              checked={presentation.showAuthor}
              onChange={(event) =>
                onPresentationChange({
                  ...presentation,
                  showAuthor: event.target.checked,
                })
              }
            />
            Author
          </label>
          <label>
            <input
              type="checkbox"
              checked={showHash}
              onChange={(event) => onChange(event.target.checked)}
            />
            Hash
          </label>
          <label>
            <input
              type="checkbox"
              checked={presentation.showDate}
              onChange={(event) =>
                onPresentationChange({
                  ...presentation,
                  showDate: event.target.checked,
                })
              }
            />
            Date
          </label>
        </div>
      )}
    </>
  );
}
