import styles from './Icon.module.css';

export const actionPaths = {
  source:
    'M4 4v8m0-5h5a3 3 0 0 0 3-3M6 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0M6 14a2 2 0 1 1-4 0 2 2 0 0 1 4 0M14 2a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  fetch: 'M8 1v10m-4-4 4 4 4-4M2 11v3h12v-3',
  checkout: 'M2 8h11m-4-4 4 4-4 4',
  add: 'M8 2v12M2 8h12',
  copy: 'M6 5h7v9H6zM3 11H2V2h7v1',
  trust: 'M8 1 14 3v5c0 3-3 5-6 7-3-2-6-4-6-7V3zM5 8l2 2 4-4',
  go: 'M2 8h11m-4-4 4 4-4 4',
  more: 'M4 2v10m4-10v10m4-10v10M1 9l3 3 3-3m-2 0 3 3 3-3m-2 0 3 3 3-3',
  cherry:
    'M9 1c0 3-2 3-3 5M9 1c0 3 3 3 3 6M7 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
} as const;
export function Icon({ name }: { name: string }) {
  const path = Object.entries(actionPaths).find(([key]) => key === name)?.[1];

  if (path)
    return (
      <svg className={styles.drawing} viewBox="0 0 16 16" aria-hidden="true">
        <path d={path} />
      </svg>
    );

  return <span className={'codicon codicon-' + name} aria-hidden="true" />;
}
