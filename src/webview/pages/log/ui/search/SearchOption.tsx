import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { useState } from 'react';

import { Icon } from '@webview/shared/ui';

import styles from './SearchControls.module.css';

export function SearchOption({
  label,
  explanation,
  icon,
  pressed,
  onClick,
}: {
  label: string;
  explanation: string;
  icon: string;
  pressed: boolean;
  onClick(this: void): void;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { move: false, delay: { open: 350 } }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: 'tooltip' }),
  ]);

  return (
    <>
      <button
        ref={(node) => refs.setReference(node)}
        {...getReferenceProps()}
        className={styles.option}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <Icon name={icon} />
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={(node) => refs.setFloating(node)}
            {...getFloatingProps()}
            className={styles.tooltip}
            style={floatingStyles}
          >
            {explanation}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
