import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from '@floating-ui/react';
import clsx from 'clsx';
import { useState } from 'react';

import type { Reference, RepositoryInfo } from '@contracts/model';
import { Icon } from '@webview/shared/ui';

import type { ReferenceLabel } from '../../model/reference-labels';
import {
  buildReferenceLabels,
  descriptions,
} from '../../model/reference-labels';
import styles from './HistoryPane.module.css';

function Marker({
  kind,
  left,
}: {
  kind: ReferenceLabel['kind'];
  left?: number;
}) {
  return (
    <span
      data-ref-symbol=""
      data-ref-kind={kind}
      className={clsx(styles['ref-symbol'], styles['ref-' + kind])}
      style={left === undefined ? undefined : { left }}
    >
      <Icon name="tag" />
    </span>
  );
}

function ReferenceHover({
  labels,
  markers,
  summary,
  accessibleLabel,
  current,
  id,
}: ReturnType<typeof buildReferenceLabels> & { current: boolean; id: string }) {
  const [open, setOpen] = useState(false);
  const {
    refs: elements,
    floatingStyles,
    context,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8, crossAxis: true }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, {
    delay: { open: 300, close: 150 },
    handleClose: safePolygon({ requireIntent: false }),
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);

  return (
    <span
      ref={(node) => elements.setReference(node)}
      data-references=""
      className={styles.references}
      {...getReferenceProps({
        role: 'group',
        tabIndex: 0,
        'aria-label': accessibleLabel,
        'aria-describedby': open ? id : undefined,
      })}
    >
      <span
        className={clsx(
          styles['ref-summary'],
          current && styles['ref-current'],
        )}
      >
        <span
          data-ref-stack=""
          className={styles['ref-stack']}
          style={{ width: 16 + (markers.length - 1) * 5 }}
        >
          {[...markers].reverse().map((label, index) => (
            <Marker key={index} kind={label.kind} left={index * 5} />
          ))}
        </span>
        <span data-ref-label="" className={styles['ref-label']}>
          {summary}
        </span>
      </span>
      {open && (
        <FloatingPortal>
          <span
            ref={(node) => elements.setFloating(node)}
            id={id}
            data-reference-tooltip=""
            className={styles['ref-tooltip']}
            style={floatingStyles}
            {...getFloatingProps({
              role: 'tooltip',
              onClick: (event) => event.stopPropagation(),
            })}
          >
            {labels.map((label, index) => (
              <span
                key={index}
                data-reference-entry=""
                className={styles['ref-tooltip-entry']}
              >
                <Marker kind={label.kind} />
                <span className={styles['ref-tooltip-name']}>{label.name}</span>
                <span className={styles['ref-tooltip-kind']}>
                  {descriptions[label.kind]}
                </span>
              </span>
            ))}
          </span>
        </FloatingPortal>
      )}
    </span>
  );
}

export function ReferenceLabels({
  refs,
  repository,
  sha,
}: {
  refs: readonly Reference[];
  repository: RepositoryInfo | null;
  sha: string;
}) {
  const labels = buildReferenceLabels(refs, repository, sha);

  return labels.labels.length ? (
    <ReferenceHover
      {...labels}
      current={sha === repository?.headSha}
      id={'history-refs-' + sha}
    />
  ) : null;
}
