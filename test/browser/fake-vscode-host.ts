import { normalizeHistoryFilters } from '../../src/shared/history-filters';
import type {
  PanelBody,
  Request,
  RequestBody,
  Result,
} from '../../src/shared/messages';
import type {
  CommitRecord,
  HistoryPage,
  Reference,
  RepositoryInfo,
} from '../../src/shared/model';

declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage(message: Request<RequestBody>): void;
      getState(): unknown;
      setState(value: unknown): void;
    };
    __acquisitions: number;
    __savedWrites: unknown[];
    __requests: Request<RequestBody>[];
    __deliver: (message: Result<PanelBody>) => void;
  }
}
const identity = (number: number) => number.toString(16).padStart(40, '0');
const commits: CommitRecord[] = Array.from({ length: 2200 }, (_, i) => ({
  sha: identity(i + 1),
  parents: [identity(i + 2)],
  message:
    i === 0
      ? '<img src=x onerror="window.injected=true">'
      : 'Commit ' + (i + 1),
  authorName: 'Fixture author',
  authorEmail: 'fixture@example.test',
  authorDate: '2026-10-04T00:00:00Z',
  commitDate: '2026-10-04T00:00:00Z',
}));
const highlightFixture = new URL(location.href).searchParams.has(
  'highlight-fixture',
);

if (highlightFixture) {
  commits[1] = {
    ...commits[1]!,
    parents: [identity(3), identity(4)],
    authorName: 'Other author',
    authorEmail: 'other@example.test',
  };
}

const annotations = (page: CommitRecord[]) => ({
  user: highlightFixture ? { name: '', email: 'fixture@example.test' } : null,
  currentBranch: highlightFixture
    ? page
        .filter((commit) => commit.sha !== identity(2))
        .map((commit) => commit.sha)
    : [],
});
const repository: RepositoryInfo = {
  id: 'one',
  label: 'Example repository',
  rootUri: 'file:///example',
  headSha: identity(1),
  branch: new URL(location.href).searchParams.get('current') ?? 'main',
};
const refs: Reference[] = [
  {
    id: 'refs/heads/main',
    name: 'main',
    kind: 'local',
    sha: identity(1),
    remote: null,
  },
  {
    id: 'refs/heads/topic',
    name: 'topic',
    kind: 'local',
    sha: identity(2),
    remote: null,
  },
  {
    id: 'refs/heads/feature/nested',
    name: 'feature/nested',
    kind: 'local',
    sha: identity(3),
    remote: null,
  },
  {
    id: 'refs/remotes/origin/main',
    name: 'origin/main',
    kind: 'remote',
    sha: identity(1),
    remote: 'origin',
  },
  {
    id: 'refs/tags/v1',
    name: 'v1',
    kind: 'tag',
    sha: identity(10),
    remote: null,
  },
];

if (repository.branch !== 'main')
  refs.push({
    id: 'refs/heads/' + repository.branch,
    name: repository.branch!,
    kind: 'local',
    sha: identity(1),
    remote: null,
  });
window.__acquisitions = 0;
window.__savedWrites = [];
window.__requests = [];
window.__deliver = (message) =>
  window.dispatchEvent(new MessageEvent('message', { data: message }));
let saved: unknown = JSON.parse(
  sessionStorage.getItem('git-ui-native-state') ?? 'null',
);
let loadedActiveSha: string | null = null;
let loadedGeneration = -1;
const startupRefresh = new URL(location.href).searchParams.has(
  'startup-refresh',
);
let savedRestoreSuperseded = false;

window.acquireVsCodeApi = () => {
  window.__acquisitions++;

  return {
    getState: () => saved,
    setState: (value) => {
      window.__savedWrites.push(value);
      saved = value;
      sessionStorage.setItem('git-ui-native-state', JSON.stringify(value));
    },
    postMessage: (request) => {
      window.__requests.push(request);
      const send = (
        body: PanelBody,
        generation = request.generation,
        requestId = request.requestId,
      ) =>
        queueMicrotask(() =>
          window.__deliver({
            requestId,
            repositoryId: repository.id,
            generation,
            body,
          }),
        );
      const body = request.body;

      if (body.kind === 'ready') {
        send(
          {
            kind: 'setup',
            state: 'ready',
            message: '',
            repositories: new URL(location.href).searchParams.has('multiple')
              ? [
                  repository,
                  {
                    ...repository,
                    id: 'two',
                    label: 'Second repository',
                    rootUri: 'file:///second',
                  },
                ]
              : [repository],
          },
          0,
        );
        send(
          { kind: 'loading', repository, scope: { kind: 'head' }, text: '' },
          1,
        );
        send(
          {
            kind: 'history',
            page: {
              commits: commits.slice(0, 200),
              refs,
              nextCursor: '200',
              scopeId: 'fixture',
              annotations: annotations(commits.slice(0, 200)),
            },
            append: false,
            scope: { kind: 'head' },
            text: '',
            repository,
          },
          1,
        );
      }

      if (body.kind === 'restore') {
        // Reproduce a Git discovery event rejecting the first stale restore.
        const superseded = startupRefresh && !savedRestoreSuperseded;
        const responseId = superseded ? 'refresh' : request.requestId;

        savedRestoreSuperseded = true;
        loadedActiveSha = null;
        send(
          {
            kind: 'loading',
            scope: body.scope,
            text: body.text,
            filters: normalizeHistoryFilters(body.filters),
            repository,
            preserve: true,
          },
          request.generation + 1,
          responseId,
        );
        send(
          {
            kind: 'history',
            page: {
              commits: commits.slice(0, 200),
              refs,
              nextCursor: '200',
              scopeId: 'fixture',
              annotations: annotations(commits.slice(0, 200)),
            },
            append: false,
            ...(startupRefresh ? { restoring: true } : {}),
            scope: body.scope,
            text: body.text,
            filters: normalizeHistoryFilters(body.filters),
            repository,
          },
          request.generation + 1,
          responseId,
        );
        send(
          {
            kind: 'selection',
            sha: superseded ? null : (body.selection?.sha ?? null),
            parentSha: superseded ? null : (body.selection?.parentSha ?? null),
            filePath: superseded ? null : (body.selection?.filePath ?? null),
            anchor: body.anchor,
          },
          request.generation + 1,
          responseId,
        );
        if (startupRefresh) {
          const commit =
            !superseded && body.selection
              ? commits.find((item) => item.sha === body.selection?.sha)
              : undefined;

          if (commit) {
            loadedActiveSha = commit.sha;
            loadedGeneration = request.generation + 1;
            send(
              { kind: 'details', commit },
              request.generation + 1,
              responseId,
            );
            send(
              {
                kind: 'files',
                sha: commit.sha,
                parentSha: commit.parents[0] ?? null,
                files: [],
              },
              request.generation + 1,
              responseId,
            );
          }

          send({ kind: 'history-settled' }, request.generation + 1, responseId);
        }
      }

      if (body.kind === 'history') {
        if (!body.cursor) loadedActiveSha = null;
        const offset = body.cursor ? Number(body.cursor) : 0;
        const page: HistoryPage = {
          commits: commits.slice(offset, offset + 200),
          refs,
          nextCursor:
            offset + 200 < commits.length ? String(offset + 200) : null,
          scopeId: 'fixture',
          annotations: annotations(commits.slice(offset, offset + 200)),
        };

        send({
          kind: 'history',
          page,
          append: offset !== 0,
          scope: body.scope,
          text: body.text,
          filters: normalizeHistoryFilters(body.filters),
          repository,
        });
      }

      if (body.kind === 'select-commits') {
        const commit = commits.find((item) => item.sha === body.activeSha);

        if (
          commit &&
          (loadedActiveSha !== body.activeSha ||
            loadedGeneration !== request.generation)
        ) {
          loadedActiveSha = body.activeSha;
          loadedGeneration = request.generation;
          send({ kind: 'details', commit });
          send({
            kind: 'files',
            sha: commit.sha,
            parentSha: commit.parents[0] ?? null,
            files: [],
          });
        }
      }

      if (body.kind === 'worktrees') send({ kind: 'worktrees', worktrees: [] });
    },
  };
};
