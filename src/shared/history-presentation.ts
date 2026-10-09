import type { HistoryPresentation } from './model';
import { isRecord } from './validation';

export function readHistoryPresentation(value?: unknown): HistoryPresentation {
  const saved = isRecord(value) ? value : {};
  const enabled = (name: keyof HistoryPresentation) =>
    typeof saved[name] === 'boolean' ? saved[name] : true;

  return {
    showAuthor: enabled('showAuthor'),
    showDate: enabled('showDate'),
    highlightMyCommits: enabled('highlightMyCommits'),
    highlightMergeCommits: enabled('highlightMergeCommits'),
    highlightCurrentBranch: enabled('highlightCurrentBranch'),
  };
}
