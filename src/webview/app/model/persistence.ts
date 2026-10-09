import {
  isHistoryFilters,
  normalizeHistoryFilters,
} from '@contracts/history-filters';
import { readHistoryPresentation } from '@contracts/history-presentation';
import type {
  RepositoryInfo,
  RestorableView,
  Scope,
  ScrollAnchor,
  Selection,
} from '@contracts/model';
import { isRecord } from '@contracts/validation';

const isString = (value: unknown, max = 8192): value is string =>
  typeof value === 'string' && value.length <= max;
const isSha = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value);

export function readSaved(saved: unknown): RestorableView {
  const defaults: RestorableView = {
    repositoryId: null,
    activeView: 'log',
    scope: { kind: 'head' },
    text: '',
    selectedRefId: null,
    selection: null,
    anchor: null,
    paneWidths: [220, 350],
    branchesCollapsed: false,
    historyColumnWidths: null,
    filters: normalizeHistoryFilters(),
    showHash: false,
    presentation: readHistoryPresentation(),
    hashColumnWidth: 100,
  };

  if (!isRecord(saved)) return defaults;
  let scope: Scope = { kind: 'head' };

  if (isRecord(saved.scope)) {
    if (saved.scope.kind === 'all') scope = { kind: 'all' };
    else if (
      saved.scope.kind === 'ref' &&
      isString(saved.scope.refId) &&
      /^refs\/(heads|remotes|tags)\//.test(saved.scope.refId)
    )
      scope = { kind: 'ref', refId: saved.scope.refId };
    else if (saved.scope.kind === 'commit' && isSha(saved.scope.sha))
      scope = { kind: 'commit', sha: saved.scope.sha };
  }

  let selection: Selection | null = null;

  if (
    isRecord(saved.selection) &&
    isSha(saved.selection.sha) &&
    (saved.selection.parentSha === null || isSha(saved.selection.parentSha)) &&
    (saved.selection.filePath === null || isString(saved.selection.filePath))
  )
    selection = {
      sha: saved.selection.sha,
      parentSha: saved.selection.parentSha,
      filePath: saved.selection.filePath,
    };
  let anchor: ScrollAnchor | null = null;

  if (
    isRecord(saved.anchor) &&
    isSha(saved.anchor.sha) &&
    typeof saved.anchor.offset === 'number' &&
    Number.isFinite(saved.anchor.offset) &&
    saved.anchor.offset >= 0 &&
    saved.anchor.offset < 22
  )
    anchor = { sha: saved.anchor.sha, offset: saved.anchor.offset };
  const widths = saved.paneWidths;
  const columns = saved.historyColumnWidths;
  const historyColumnWidths: [number, number] | null =
    Array.isArray(columns) &&
    columns.length === 2 &&
    typeof columns[0] === 'number' &&
    typeof columns[1] === 'number' &&
    columns.every(
      (value) =>
        typeof value === 'number' && Number.isFinite(value) && value <= 10000,
    ) &&
    columns[0] >= 65 &&
    columns[1] >= 80
      ? [columns[0], columns[1]]
      : null;
  const paneWidths: [number, number] =
    Array.isArray(widths) &&
    widths.length === 2 &&
    typeof widths[0] === 'number' &&
    typeof widths[1] === 'number' &&
    widths.every(
      (value) =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 150 &&
        value <= 600,
    )
      ? [widths[0], widths[1]]
      : defaults.paneWidths;

  return {
    ...defaults,
    repositoryId: isString(saved.repositoryId) ? saved.repositoryId : null,
    activeView: saved.activeView === 'worktrees' ? 'worktrees' : 'log',
    scope,
    text: isString(saved.text, 4096) ? saved.text : '',
    selectedRefId: isString(saved.selectedRefId) ? saved.selectedRefId : null,
    selection,
    anchor,
    paneWidths,
    branchesCollapsed: saved.branchesCollapsed === true,
    historyColumnWidths,
    filters: isHistoryFilters(saved.filters)
      ? normalizeHistoryFilters(saved.filters)
      : normalizeHistoryFilters(),
    showHash: saved.showHash === true,
    presentation: readHistoryPresentation(saved.presentation),
    hashColumnWidth:
      typeof saved.hashColumnWidth === 'number' &&
      Number.isFinite(saved.hashColumnWidth) &&
      saved.hashColumnWidth >= 65 &&
      saved.hashColumnWidth <= 10000
        ? saved.hashColumnWidth
        : 100,
  };
}

export function restoreView(
  saved: unknown,
  repositories: readonly RepositoryInfo[],
): RestorableView {
  const view = readSaved(saved);

  if (repositories.some((repo) => repo.id === view.repositoryId)) return view;

  return {
    ...readSaved(null),
    activeView: view.activeView,
    paneWidths: view.paneWidths,
    branchesCollapsed: view.branchesCollapsed ?? false,
    historyColumnWidths: view.historyColumnWidths ?? null,
    showHash: view.showHash ?? false,
    presentation: readHistoryPresentation(view.presentation),
    hashColumnWidth: view.hashColumnWidth ?? 100,
  };
}
