import type { SourceControlTab } from '@contracts/source-control';
import { isRecord } from '@contracts/validation';

export interface SourceControlView {
  repositoryId: string | null;
  tab: SourceControlTab;
  collapsed: string[];
  expandedStashes: string[];
  groupByDirectory: boolean;
}

export function readView(value: unknown): SourceControlView {
  if (!isRecord(value))
    return {
      repositoryId: null,
      tab: 'commit',
      collapsed: [],
      expandedStashes: [],
      groupByDirectory: true,
    };

  return {
    repositoryId:
      typeof value.repositoryId === 'string' ? value.repositoryId : null,
    tab: value.tab === 'stash' ? 'stash' : 'commit',
    collapsed: Array.isArray(value.collapsed)
      ? value.collapsed.filter(
          (item: unknown): item is string => typeof item === 'string',
        )
      : [],
    expandedStashes: Array.isArray(value.expandedStashes)
      ? value.expandedStashes.filter(
          (item: unknown): item is string => typeof item === 'string',
        )
      : [],
    groupByDirectory: value.groupByDirectory !== false,
  };
}

export function folderKey(repositoryId: string, section: string, path: string) {
  return JSON.stringify([repositoryId, section, path]);
}
