import type { CommitRecord } from '@contracts/model';

import type { ISCMHistoryItemViewModel } from '../../../../../vendor/vscode-graph/graph';
import {
  SWIMLANE_HEIGHT,
  toISCMHistoryItemViewModelArray,
} from '../../../../../vendor/vscode-graph/graph';

export interface GraphRow {
  sha: string;
  height: number;
  missingParents: string[];
  viewModel: ISCMHistoryItemViewModel;
}
export class GraphAdapter {
  layout(
    commits: readonly CommitRecord[],
    mode: 'history' | 'search',
    headSha: string | null = null,
  ): GraphRow[] {
    const ids = new Set(commits.map((commit) => commit.sha));
    const models = toISCMHistoryItemViewModelArray(
      commits.map((commit) => ({
        id: commit.sha,
        parentIds:
          mode === 'search'
            ? commit.parents.filter((sha) => ids.has(sha))
            : [...commit.parents],
        subject: commit.message.split('\n')[0] ?? '',
        message: commit.message,
      })),
      undefined,
      headSha ? { id: 'HEAD', name: 'HEAD', revision: headSha } : undefined,
    );

    return models.map((viewModel, index) => ({
      sha: viewModel.historyItem.id,
      height: SWIMLANE_HEIGHT,
      missingParents: (commits[index]?.parents ?? []).filter(
        (sha) => !ids.has(sha),
      ),
      viewModel,
    }));
  }
}
