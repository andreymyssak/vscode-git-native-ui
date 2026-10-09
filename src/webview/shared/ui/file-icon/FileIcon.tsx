import { useContext, useState } from 'react';

import { resolveFileIcon } from '@contracts/file-icons';

import { Icon } from '../icon/Icon';
import styles from './FileIcon.module.css';
import { FileIconThemeContext } from './FileIconTheme';

type Fallback =
  'file' | 'folder' | 'json' | 'file-code' | 'file-media' | 'file-zip';

function ImageIcon({ uri, fallback }: { uri: string; fallback: Fallback }) {
  const [failed, setFailed] = useState(false);

  return failed ? (
    <Icon name={fallback} />
  ) : (
    <img src={uri} alt="" onError={() => setFailed(true)} />
  );
}

export function FileIcon({
  path,
  kind,
  expanded = false,
  fallback,
}: {
  path: string;
  kind: 'file' | 'folder';
  expanded?: boolean;
  fallback: Fallback;
}) {
  const theme = useContext(FileIconThemeContext);
  const icon = theme ? resolveFileIcon(theme, path, kind, expanded) : undefined;

  if (theme && !icon) return null;

  return (
    <span
      aria-hidden="true"
      data-file-icon={kind}
      className={[styles.icon, icon?.className].filter(Boolean).join(' ')}
    >
      {icon?.uri ? (
        <ImageIcon key={icon.uri} uri={icon.uri} fallback={fallback} />
      ) : !icon?.className ? (
        <Icon name={fallback} />
      ) : null}
    </span>
  );
}
