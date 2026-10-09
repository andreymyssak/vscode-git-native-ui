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
import type { ReactNode } from 'react';
import { useState } from 'react';

import { Icon } from '@webview/shared/ui';

import styles from './Dropdown.module.css';

export function FilterDropdown({
  id,
  name,
  label,
  title = label,
  active,
  panelLabel,
  onClear,
  onOpen,
  children,
}: {
  id: string;
  name: string;
  label: string;
  title?: string;
  active: boolean;
  panelLabel: string;
  onClear(this: void): void;
  onOpen?(this: void): void;
  children(this: void, close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (value) => {
      if (value) onOpen?.();
      setOpen(value);
    },
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(4), flip(), shift({ padding: 9, crossAxis: true })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ]);

  return (
    <>
      <div className={styles.control} data-active={active}>
        <button
          id={id}
          ref={(node) => refs.setReference(node)}
          {...getReferenceProps()}
          className={styles.trigger}
          aria-label={`${name} filter`}
          title={title}
        >
          <span className={styles.label}>{label}</span>
          <span className={styles.chevron} aria-hidden="true">
            <Icon name="chevron-down" />
          </span>
        </button>
        {active && (
          <button
            className={styles.clear}
            aria-label={`Clear ${name.toLowerCase()} filter`}
            title={`Clear ${name.toLowerCase()} filter`}
            onClick={() => {
              onClear();
              setOpen(false);
              const reference = refs.domReference.current;

              if (reference instanceof HTMLElement) reference.focus();
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={(node) => refs.setFloating(node)}
              {...getFloatingProps()}
              className={styles.panel}
              style={floatingStyles}
              aria-label={panelLabel}
            >
              {children(() => setOpen(false))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
