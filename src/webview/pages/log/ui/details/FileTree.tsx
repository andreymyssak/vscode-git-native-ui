import type { CSSProperties, KeyboardEvent } from 'react';
import { useState } from 'react';

import type { FileChange } from '@contracts/model';
import { FileIcon, Icon } from '@webview/shared/ui';

import type { FileTreeNode } from '../../model/file-tree';
import styles from './ChangedFiles.module.css';

interface Props {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  depth?: number;
  onOpen(this: void, fileId: string, preview: boolean): void;
}

export const fileCountLabel = (count: number) =>
  `${count} ${count === 1 ? 'file' : 'files'}`;
const indentation = (depth: number) =>
  ({ '--tree-depth': depth }) satisfies CSSProperties;

export function navigateFileTree(event: KeyboardEvent<HTMLDivElement>) {
  if (
    ![
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
    ].includes(event.key) ||
    !(event.target instanceof HTMLElement)
  )
    return;
  const nodes = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  ].filter((node) => node.getClientRects().length > 0);
  const target = event.target;
  const index = nodes.indexOf(target);

  if (index < 0) return;
  event.preventDefault();
  const folder = target.closest('details');

  if (event.key === 'ArrowRight') {
    if (target.tagName === 'SUMMARY' && folder) {
      if (!folder.open) folder.open = true;
      else
        folder
          .querySelector(':scope > [role="group"]')
          ?.querySelector<HTMLElement>('[role="treeitem"]')
          ?.focus();
    }

    return;
  }

  if (event.key === 'ArrowLeft') {
    if (target.tagName === 'SUMMARY' && folder?.open) folder.open = false;
    else {
      const parent =
        target.tagName === 'SUMMARY'
          ? folder?.parentElement?.closest('details')
          : folder;

      parent?.querySelector('summary')?.focus();
    }

    return;
  }

  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? nodes.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(nodes.length - 1, index + 1)
          : Math.max(0, index - 1);

  nodes[next]?.focus();
}

export function FileTree({ nodes, selectedPath, depth = 1, onOpen }: Props) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <FileFolder
            key={node.id}
            node={node}
            selectedPath={selectedPath}
            depth={depth}
            onOpen={onOpen}
          />
        ) : (
          <FileLeaf
            key={node.id}
            file={node.change}
            name={node.name}
            selectedPath={selectedPath}
            depth={depth}
            onOpen={onOpen}
          />
        ),
      )}
    </>
  );
}

function FileFolder({
  node,
  selectedPath,
  depth = 1,
  onOpen,
}: Omit<Props, 'nodes'> & {
  node: Extract<FileTreeNode, { kind: 'folder' }>;
}) {
  const selected = (selectedPath ?? '').startsWith(node.id.slice(7));
  const [open, setOpen] = useState(true);
  const [previousSelection, setPreviousSelection] = useState(selected);

  if (previousSelection !== selected) {
    setPreviousSelection(selected);
    if (selected) setOpen(true);
  }

  return (
    <details
      data-folder={node.name}
      open={open}
      style={indentation(depth)}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        role="treeitem"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${node.name} ${fileCountLabel(node.files)}`}
        className={styles.row}
        title={node.id.slice(7, -1)}
      >
        <span className={styles.chevron}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        </span>
        <span className={styles.glyph}>
          <FileIcon
            path={node.id.slice(7, -1)}
            kind="folder"
            expanded={open}
            fallback="folder"
          />
        </span>
        <span className={styles.name}>
          {node.name.split('/').map((part, index) => (
            <span key={index}>
              {index > 0 && (
                <span data-path-separator className={styles.separator}>
                  /
                </span>
              )}
              {part}
            </span>
          ))}
        </span>
        <span className={styles.count}>{fileCountLabel(node.files)}</span>
      </summary>
      <div role="group" className={styles.children}>
        <FileTree
          nodes={node.children}
          selectedPath={selectedPath}
          depth={depth + 1}
          onOpen={onOpen}
        />
      </div>
    </details>
  );
}

function fileIcon(name: string) {
  if (/\.(?:json|jsonc)$/i.test(name)) return 'json';
  if (/\.(?:ts|tsx|js|jsx|html|css|scss|py|go|rs|sh|ya?ml)$/i.test(name))
    return 'file-code';
  if (/\.(?:png|jpg|jpeg|gif|svg|webp|ico)$/i.test(name)) return 'file-media';
  if (/\.(?:zip|gz|tar|7z)$/i.test(name)) return 'file-zip';

  return 'file';
}

function FileLeaf({
  file,
  name,
  selectedPath,
  depth,
  onOpen,
}: {
  file: FileChange;
  name: string;
  depth: number;
} & Pick<Props, 'selectedPath' | 'onOpen'>) {
  const path = file.newPath ?? file.oldPath ?? '';
  const label =
    file.status[0]!.toUpperCase() + file.status.slice(1) + ' · ' + name;

  return (
    <button
      type="button"
      role="treeitem"
      aria-label={label}
      aria-selected={path === selectedPath}
      className={`${styles.row} ${styles.leaf}`}
      style={indentation(depth)}
      data-file={file.id}
      data-path={path}
      data-status={file.status}
      title={
        file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : path
      }
      onClick={(event) => {
        if (event.detail < 2) onOpen(file.id, true);
      }}
      onDoubleClick={() => onOpen(file.id, false)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen(file.id, false);
        }
      }}
    >
      <span className={styles.chevron} />
      <span className={styles.glyph}>
        <FileIcon path={path} kind="file" fallback={fileIcon(name)} />
      </span>
      <span className={styles.name}>{name}</span>
      <span className={styles.status} aria-hidden="true">
        {file.status[0]!.toUpperCase()}
      </span>
    </button>
  );
}
