import type { FileChange } from '../../src/shared/model';

export const changedFiles: FileChange[] = [
  {
    id: 'lock-file',
    status: 'modified',
    oldPath: 'common/config/rush/pnpm-lock.yaml',
    newPath: 'common/config/rush/pnpm-lock.yaml',
  },
  {
    id: 'state-file',
    status: 'modified',
    oldPath: 'common/config/rush/repo-state.json',
    newPath: 'common/config/rush/repo-state.json',
  },
  {
    id: 'ems-change',
    status: 'added',
    oldPath: null,
    newPath: 'common/changes/@ems-libs/change.json',
  },
  {
    id: 'wk-change',
    status: 'modified',
    oldPath: 'common/changes/@wk/change.json',
    newPath: 'common/changes/@wk/change.json',
  },
  {
    id: 'api-file',
    status: 'renamed',
    oldPath: 'packages/api/src/old.ts',
    newPath: 'packages/api/src/index.ts',
  },
  {
    id: 'deleted-file',
    status: 'deleted',
    oldPath: 'obsolete.txt',
    newPath: null,
  },
];
