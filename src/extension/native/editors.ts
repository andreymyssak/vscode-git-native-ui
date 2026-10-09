import * as vscode from 'vscode';

import type { GitApiAccess } from '../git/api';
import type { FileHandle } from '../panel/queries';

export function changeUris(
  access: GitApiAccess,
  id: string,
  handle: FileHandle,
): { original: vscode.Uri; modified: vscode.Uri } {
  const root = access.repository(id).rootUri;
  const revision = (path: string, sha: string) => {
    if (
      path.startsWith('/') ||
      path.split('/').some((part) => part === '..' || part === '.') ||
      path.includes('\0')
    )
      throw new Error('Invalid historical file path.');

    return access.api.toGitUri(
      vscode.Uri.joinPath(root, ...path.split('/')),
      sha,
    );
  };

  const empty = (side: string) =>
    vscode.Uri.from({
      scheme: 'git-native-ui-empty',
      path: `/${handle.sha}/${side}/${handle.file.newPath ?? handle.file.oldPath ?? 'file'}`,
      query: handle.file.id,
    });

  return {
    original:
      handle.file.oldPath !== null && handle.parentSha !== null
        ? revision(handle.file.oldPath, handle.parentSha)
        : empty('original'),
    modified:
      handle.file.newPath !== null
        ? revision(handle.file.newPath, handle.sha)
        : empty('modified'),
  };
}

export async function openChange(
  access: GitApiAccess,
  id: string,
  handle: FileHandle,
  preview: boolean,
  current: () => boolean = () => true,
): Promise<void> {
  // With no visible text editor, revealing one may restore a maximized panel
  // and move the clicked row. Keep the gesture guard in this conservative case;
  // visible text editors open immediately.
  if (preview && vscode.window.visibleTextEditors.length === 0)
    await new Promise((resolve) => setTimeout(resolve, 500));
  if (!current()) return;
  const { original, modified } = changeUris(access, id, handle);

  await vscode.commands.executeCommand(
    'vscode.diff',
    original,
    modified,
    `${handle.file.newPath ?? handle.file.oldPath ?? 'File'} (${handle.parentSha?.slice(0, 8) ?? 'empty'} ↔ ${handle.sha.slice(0, 8)})`,
    { preview },
  );
}
