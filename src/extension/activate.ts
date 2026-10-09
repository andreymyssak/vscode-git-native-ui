import * as vscode from 'vscode';

import { EmptyDocumentProvider } from './native/empty-document';
import { GitNativeUIProvider } from './panel/provider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new GitNativeUIProvider(
    context.extensionUri,
    context.globalStorageUri,
  );

  for (const kind of [
    'update-branch',
    'merge-branch',
    'rebase-branch',
    'create-worktree',
    'checkout',
    'create-branch',
    'rename-branch',
    'delete-branch',
    'delete-branches',
    'copy-branch',
  ] as const)
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `gitNativeUI.${kind}`,
        async (value: unknown) => {
          try {
            await provider.executeBranchAction(kind, value);
          } catch (error) {
            await vscode.window.showErrorMessage(
              error instanceof Error ? error.message : String(error),
              'Dismiss',
            );
          }
        },
      ),
    );
  for (const kind of [
    'copy-sha',
    'cherry-pick',
    'edit-commit-message',
    'squash-commits',
    'branch-from-commit',
    'tag-from-commit',
    'drop-commits',
  ] as const)
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `gitNativeUI.${kind}`,
        async (value: unknown) => {
          try {
            await provider.executeCommitAction(kind, value);
          } catch (error) {
            await vscode.window.showErrorMessage(
              error instanceof Error ? error.message : String(error),
              'Dismiss',
            );
          }
        },
      ),
    );
  for (const kind of [
    'open-worktree-new',
    'open-worktree-current',
    'delete-worktrees',
  ] as const)
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `gitNativeUI.${kind}`,
        async (value: unknown) => {
          try {
            await provider.executeWorktreeAction(kind, value);
          } catch (error) {
            await vscode.window.showErrorMessage(
              error instanceof Error ? error.message : String(error),
              'Dismiss',
            );
          }
        },
      ),
    );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      'git-native-ui-empty',
      new EmptyDocumentProvider(),
    ),
    vscode.window.registerWebviewViewProvider('gitNativeUI.log', provider),
  );
}
