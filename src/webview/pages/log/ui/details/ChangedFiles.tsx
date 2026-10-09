import clsx from 'clsx';
import { useContext, useEffect, useRef, useState } from 'react';

import { FileIconThemeContext, Icon } from '@webview/shared/ui';

import { buildFileTree } from '../../model/file-tree';
import type { LogData, LogIntent } from '../../model/view';
import styles from './ChangedFiles.module.css';
import { fileCountLabel, FileTree, navigateFileTree } from './FileTree';

type Props = {
  data: LogData;
  inactive?: boolean;
  onIntent(this: void, intent: LogIntent): void;
};

function ParentGroup({
  parent,
  index,
  data,
  onIntent,
  inactive = false,
}: {
  parent: string | null;
  index: number;
} & Props) {
  const commit = data.details!;
  const key = parent ?? 'root';
  const files = data.files[key];
  const error = data.fileErrors[key];
  const label =
    parent === null
      ? 'Root changes'
      : `Changes to Parent ${index + 1} · ${parent.slice(0, 8)}`;
  const selectedPath =
    data.selectedSha === commit.sha &&
    data.selectedParentSha === parent &&
    files?.some(
      (file) => (file.newPath ?? file.oldPath) === data.selectedFilePath,
    )
      ? data.selectedFilePath
      : null;
  const [open, setOpen] = useState(index === 0 || selectedPath !== null);
  const requested = useRef<number | null>(null);
  const [loadingGeneration, setLoadingGeneration] = useState<number | null>(
    null,
  );
  const [previousPath, setPreviousPath] = useState(selectedPath);

  if (previousPath !== selectedPath) {
    setPreviousPath(selectedPath);
    if (selectedPath !== null) setOpen(true);
  }

  useEffect(() => {
    if (
      !inactive &&
      !files &&
      !error &&
      requested.current !== data.generation
    ) {
      requested.current = data.generation;
      onIntent({
        kind: 'request',
        body: { kind: 'load-parent', sha: commit.sha, parentSha: parent },
      });
    }
  }, [files, error, commit.sha, parent, onIntent, inactive, data.generation]);
  useEffect(() => {
    if (inactive || !open || files || error) return;
    const timeout = setTimeout(
      () => setLoadingGeneration(data.generation),
      200,
    );

    return () => clearTimeout(timeout);
  }, [open, files, error, inactive, data.generation]);
  const comparison = commit.parents.length > 1;
  const emptyMessage =
    parent === null
      ? 'This commit contains no files.'
      : 'No changes compared with this parent.';

  return (
    <details
      data-parent={key}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        role="treeitem"
        tabIndex={0}
        aria-expanded={open}
        className={clsx(styles.row, styles.group)}
        aria-label={
          label +
          ' · ' +
          (files
            ? fileCountLabel(files.length)
            : error
              ? 'Comparison unavailable'
              : 'Loading file count')
        }
        title={label}
      >
        <span className={styles.chevron}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        </span>
        <span className={styles.name}>{comparison ? label : 'Changes'}</span>
        <span
          className={clsx(styles.count, styles.comparisonCount)}
          aria-label={!files && !error ? 'Loading file count' : undefined}
        >
          {files ? fileCountLabel(files.length) : error ? 'Unavailable' : '…'}
        </span>
      </summary>
      <div
        role="group"
        className={clsx(styles.children, styles.comparisonBody)}
        aria-busy={!files && !error}
      >
        {files ? (
          files.length ? (
            <FileTree
              nodes={buildFileTree(files)}
              selectedPath={selectedPath}
              onOpen={(fileId, preview) =>
                onIntent({
                  kind: 'request',
                  body: { kind: 'open-file', fileId, preview },
                })
              }
            />
          ) : (
            <p
              className={clsx(styles.message, styles.empty)}
              title={emptyMessage}
            >
              {emptyMessage}
            </p>
          )
        ) : error ? (
          <div className={styles.unloaded}>
            <p className={styles.message}>{error}</p>
            <button
              type="button"
              className={styles.retry}
              onClick={() =>
                onIntent({
                  kind: 'request',
                  body: {
                    kind: 'load-parent',
                    sha: commit.sha,
                    parentSha: parent,
                  },
                })
              }
            >
              Retry comparison
            </button>
          </div>
        ) : (
          <p
            className={styles.message}
            role="status"
            aria-label="Loading comparison"
          >
            {loadingGeneration === data.generation
              ? 'Loading comparison…'
              : '\u00a0'}
          </p>
        )}
      </div>
    </details>
  );
}

export function ChangedFiles({ data, onIntent, inactive = false }: Props) {
  const parents = data.details?.parents.length ? data.details.parents : [null];
  const theme = useContext(FileIconThemeContext);
  const associations = theme?.associations;
  const hasFiles =
    !associations ||
    !!associations.file ||
    [
      associations.fileNames,
      associations.fileExtensions,
      associations.languageIds,
    ].some((map) => Object.keys(map).length > 0);
  const hasFolders =
    !associations ||
    !!associations.folder ||
    !!associations.folderExpanded ||
    [associations.folderNames, associations.folderNamesExpanded].some(
      (map) => Object.keys(map).length > 0,
    );

  return (
    <div
      id="files"
      className={clsx(
        styles.files,
        hasFiles && !hasFolders && styles.alignFileIcons,
      )}
      role="tree"
      aria-label="Changed files"
      onKeyDown={navigateFileTree}
    >
      {parents.map((parent, index) => (
        <ParentGroup
          key={parent ?? 'root'}
          parent={parent}
          index={index}
          data={data}
          inactive={inactive}
          onIntent={inactive ? ignoreIntent : onIntent}
        />
      ))}
    </div>
  );
}

function ignoreIntent() {}
