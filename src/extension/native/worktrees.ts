import { stat } from 'node:fs/promises';

import * as vscode from 'vscode';

import type { WorktreeInfo } from '../../shared/model';

export type FolderOptions =
  { forceNewWindow: true } | { forceReuseWindow: true };
export async function openWorktree(
  worktree: WorktreeInfo,
  destination: 'new' | 'current',
  open: (uri: vscode.Uri, options: FolderOptions) => Promise<void> = async (
    uri,
    options,
  ) => {
    await vscode.commands.executeCommand('vscode.openFolder', uri, options);
  },
): Promise<void> {
  const uri = vscode.Uri.parse(worktree.rootUri);

  if (uri.scheme !== 'file')
    throw new Error('This worktree is not a local folder.');
  try {
    if (!(await stat(uri.fsPath)).isDirectory())
      throw new Error('Not a folder');
  } catch {
    throw new Error(
      'The worktree folder is unavailable. Refresh the worktree list.',
    );
  }

  await open(
    uri,
    destination === 'new'
      ? { forceNewWindow: true }
      : { forceReuseWindow: true },
  );
}
