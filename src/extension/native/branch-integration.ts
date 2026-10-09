import { basename, dirname, isAbsolute, join } from 'node:path';

import * as vscode from 'vscode';

import type { Reference } from '../../shared/model';
import { askBranchName } from './dialogs';

export async function confirmBranchIntegration(
  kind: 'merge-branch' | 'rebase-branch',
  current: string,
  selected: string,
): Promise<boolean> {
  const method = kind === 'merge-branch' ? 'Merge' : 'Rebase';
  const label =
    kind === 'merge-branch'
      ? `Merge "${selected}" into "${current}"?`
      : `Rebase "${current}" on "${selected}"? This rewrites its local commits.`;

  return (
    (await vscode.window.showInformationMessage(label, method, 'Cancel')) ===
    method
  );
}

export async function pickWorktreeBranch(
  references: readonly Reference[],
  currentBranch: string | null,
): Promise<string | null> {
  const choices = references
    .map((ref) => ({
      label: ref.name,
      description:
        ref.kind === 'remote'
          ? 'Remote branch'
          : ref.name === currentBranch
            ? 'Current branch'
            : '',
      refId: ref.id,
    }))
    .sort(
      (a, b) =>
        Number(b.refId === `refs/heads/${currentBranch}`) -
          Number(a.refId === `refs/heads/${currentBranch}`) ||
        a.label.localeCompare(b.label),
    );
  const selected = await vscode.window.showQuickPick(choices, {
    title: 'Create Worktree',
    placeHolder: 'Select a branch',
    matchOnDescription: true,
  });

  return selected?.refId ?? null;
}

export async function askWorktree(
  reference: Reference,
  rootUri: string,
  currentBranch: string | null,
): Promise<{ path: string; name: string | null } | null> {
  let name: string | null = null;
  let createBranch =
    reference.kind === 'remote' || reference.name === currentBranch;

  if (!createBranch) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: `Use "${reference.name}"`, create: false },
        { label: 'Create a New Branch…', create: true },
      ],
      {
        title: `New Worktree from "${reference.name}"`,
        placeHolder: 'Choose the branch to check out in the new worktree',
      },
    );

    if (!choice) return null;
    createBranch = choice.create;
  }

  if (createBranch) {
    const base =
      reference.kind === 'remote'
        ? reference.name.slice(reference.name.indexOf('/') + 1)
        : reference.name;

    name = await askBranchName(
      `${base}-worktree`,
      `Create a new branch from "${reference.name}" for the worktree`,
    );
    if (name === null) return null;
  }

  const root = vscode.Uri.parse(rootUri).fsPath;
  const folder = (name ?? reference.name).replace(/[/\\]/g, '-');
  const path = await vscode.window.showInputBox({
    title: 'Worktree Folder',
    prompt: `Create a worktree from "${reference.name}" in a new folder`,
    value: join(dirname(root), `${basename(root)}-${folder}`),
    ignoreFocusOut: true,
    validateInput: (value) =>
      isAbsolute(value) ? null : 'Enter an absolute folder path.',
  });

  return path === undefined ? null : { path, name };
}
