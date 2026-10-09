import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { useState } from 'react';

import type { HistoryPresentation } from '@contracts/model';
import { Icon } from '@webview/shared/ui';

import { ColumnOptions } from './ColumnOptions';
import styles from './HistoryToolbar.module.css';

export function ViewOptions({
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
    placement: 'bottom-end',
    strategy: 'fixed',
    transform: false,
    middleware: [offset(4), flip(), shift({ padding: 8, crossAxis: true })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);

  return (
    <>
      <button
        ref={(node) => refs.setReference(node)}
        {...getReferenceProps()}
        className={styles.icon}
        aria-label="View options"
        title="View options"
      >
        <Icon name="settings-gear" />
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager
            context={context}
            modal={false}
            initialFocus={-1}
          >
            <div
              ref={(node) => refs.setFloating(node)}
              {...getFloatingProps()}
              className={styles.options}
              style={floatingStyles}
              aria-label="History view options"
              onKeyDownCapture={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setOpen(false);
                  const reference = refs.domReference.current;

                  if (reference instanceof HTMLElement) reference.focus();
                }
              }}
            >
              <div className={styles.heading}>Show</div>
              <ColumnOptions
                showHash={showHash}
                onChange={onChange}
                presentation={presentation}
                onPresentationChange={onPresentationChange}
              />
              <hr className={styles.divider} />
              <div className={styles.heading}>Highlight</div>
              <div role="group" aria-label="Highlight">
                {(
                  [
                    [
                      'highlightMyCommits',
                      'My Commits',
                      'Bold author names matching your configured Git identity.',
                    ],
                    [
                      'highlightMergeCommits',
                      'Merge Commits',
                      'Deemphasize merge messages and metadata.',
                    ],
                    [
                      'highlightCurrentBranch',
                      'Current Branch',
                      'Tint commits reachable from the checked-out branch. Selection uses a stronger color.',
                    ],
                  ] as const
                ).map(([key, label, explanation]) => (
                  <label key={key} title={explanation}>
                    <input
                      type="checkbox"
                      checked={presentation[key]}
                      onChange={(event) =>
                        onPresentationChange({
                          ...presentation,
                          [key]: event.target.checked,
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
