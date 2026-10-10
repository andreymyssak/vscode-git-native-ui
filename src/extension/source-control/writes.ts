import * as vscode from 'vscode';

import type { StashFileKey, WorkingFile } from '../../shared/source-control';
import {
  dirtySelectedDocuments,
  messagePrompt,
  saveSelectedDocuments,
} from '../changes/prompts';
import type { GitApiAccess } from '../git/api';
import type { GitCli } from '../git/cli';
import { withRepositoryOperation } from '../git/repository-operations';
import {
  captureSelection,
  commitSelected,
  stashSelected,
} from '../git/selected-changes';
import {
  applyStash,
  deleteStash,
  restoreStashFiles,
} from '../git/stash-operations';
import { readStashFiles } from '../git/stashes';
import { showOperationInfo } from '../native/operation-feedback';
import type { SourceControlModel } from './model';

export interface SourceControlRuntime {
  access: GitApiAccess;
  cli: GitCli;
}

export function requireLiveRepository(
  runtime: SourceControlRuntime,
  model: SourceControlModel,
  id: string,
) {
  const repo = model.requireRepository(id);

  if (!runtime.access.repositories().some((info) => info.id === id))
    throw new Error('The repository closed. Refresh and select it again.');
  runtime.access.repository(id);

  return repo;
}

function requireSaved(
  root: vscode.Uri,
  files: readonly Pick<WorkingFile, 'path' | 'originalPath'>[],
): void {
  if (dirtySelectedDocuments(root, files).length)
    throw new Error(
      'Selected files have unsaved edits. Save them and review your selection before continuing.',
    );
}

export async function writeChanges(options: {
  runtime: SourceControlRuntime;
  model: SourceControlModel;
  id: string;
  kind: 'commit' | 'stash' | 'stash-silently';
  nativePrompt: boolean;
  selection:
    { kind: 'checked' } | { kind: 'selected'; paths: readonly string[] };
  publish: () => void;
}): Promise<void> {
  const { runtime, model, id, kind } = options;
  const repo = requireLiveRepository(runtime, model, id);
  const currentFiles = () =>
    options.selection.kind === 'checked'
      ? model.selectedFiles(id)
      : model.workingFiles(id, options.selection.paths);
  const label = options.selection.kind;
  const files = currentFiles();

  if (!files.length) throw new Error('Select at least one changed file.');
  const selection = JSON.stringify(files);
  const root = runtime.access.repository(id).rootUri;

  if (!(await saveSelectedDocuments(root, files))) return;
  requireLiveRepository(runtime, model, id);
  if (JSON.stringify(currentFiles()) !== selection)
    throw new Error(
      `The ${label} files changed. Review them before continuing.`,
    );
  const snapshot = await captureSelection(runtime.cli, id, files);

  requireLiveRepository(runtime, model, id);
  let message = model.draft(id);

  if (!message.trim() && kind !== 'stash-silently' && options.nativePrompt) {
    const answer = await messagePrompt({
      title:
        kind === 'commit' ? 'Commit Selected Files' : 'Stash Selected Files',
      prompt: `${repo.info.label}: ${files.length} ${label} ${files.length === 1 ? 'file' : 'files'}. ${kind === 'commit' ? 'Commit message' : 'Stash description'}`,
      draft: message,
      onDraft: (value) => {
        model.setDraft(id, value);
        options.publish();
      },
    });

    if (answer === undefined) return;
    message = answer;
    model.setDraft(id, message);
  }

  const draft = model.draft(id);

  if (!message.trim() && kind === 'stash-silently') message = 'Changes';
  if (!message.trim()) throw new Error('Enter a message before continuing.');
  requireSaved(root, files);
  await withRepositoryOperation(runtime.cli, id, async () => {
    requireLiveRepository(runtime, model, id);
    if (
      JSON.stringify(currentFiles()) !== selection ||
      model.draft(id) !== draft
    )
      throw new Error(
        `The ${label} files or message changed. Review them before continuing.`,
      );
    requireSaved(root, files);
    const result = await (kind === 'commit' ? commitSelected : stashSelected)(
      runtime.cli,
      id,
      snapshot,
      message,
    );

    repo.checked.clear(files.map((file) => file.path));
    model.setDraft(id, '');
    showOperationInfo(
      kind === 'commit'
        ? `Committed ${files.length} ${label} files in ${repo.info.label}, ${result.sha.slice(0, 8)}.`
        : `Stashed ${files.length} ${label} files in ${repo.info.label}.`,
    );
  });
}

export async function restoreSaved(options: {
  runtime: SourceControlRuntime;
  model: SourceControlModel;
  id: string;
  sha: string;
  keys: readonly StashFileKey[] | null;
}): Promise<void> {
  const { runtime, model, id, sha, keys } = options;

  requireLiveRepository(runtime, model, id);
  const stash = model.requireStash(id, sha);
  const files =
    keys === null
      ? await readStashFiles(runtime.cli, id, stash)
      : model.stashFiles(id, sha, keys);
  const root = runtime.access.repository(id).rootUri;

  requireLiveRepository(runtime, model, id);
  if (!(await saveSelectedDocuments(root, files))) return;
  requireLiveRepository(runtime, model, id);
  await withRepositoryOperation(runtime.cli, id, async () => {
    requireLiveRepository(runtime, model, id);
    model.requireStash(id, sha);
    if (
      keys !== null &&
      JSON.stringify(model.stashFiles(id, sha, keys)) !== JSON.stringify(files)
    )
      throw new Error(
        'The saved selection changed. Refresh and select it again.',
      );
    requireSaved(root, files);
    if (keys === null) await applyStash(runtime.cli, id, sha);
    else await restoreStashFiles(runtime.cli, id, sha, files);
  });
}

export async function removeSaved(options: {
  runtime: SourceControlRuntime;
  model: SourceControlModel;
  id: string;
  sha: string;
}): Promise<void> {
  const { runtime, model, id, sha } = options;
  const repo = requireLiveRepository(runtime, model, id);
  const stash = model.requireStash(id, sha);
  const answer = await vscode.window.showWarningMessage(
    `Delete stash "${stash.message}" from ${repo.info.label}? Restored files remain in the working tree.`,
    'Delete Stash',
    'Cancel',
  );

  if (answer !== 'Delete Stash') return;
  requireLiveRepository(runtime, model, id);
  await withRepositoryOperation(runtime.cli, id, async () => {
    requireLiveRepository(runtime, model, id);
    model.requireStash(id, sha);
    await deleteStash(runtime.cli, id, sha);
  });
}
