import { act, renderHook } from '@testing-library/react';
import { expect, onTestFinished, test, vi } from 'vitest';

import type {
  PanelBody,
  Request,
  RequestBody,
} from '../../src/shared/messages';
import type { CommitRecord, RestorableView } from '../../src/shared/model';
import { useBrowserState } from '../../src/webview/app/model/useBrowserState';
import { createBrowserBridge } from '../../src/webview/shared/api';
import { fixture as controllerFixture } from '../fixtures/controller';

const sha = 'a'.repeat(40);
const parent = 'b'.repeat(40);
const repository = {
  id: 'one',
  label: 'One',
  rootUri: 'file:///one',
  branch: 'main',
  headSha: sha,
};
const commit: CommitRecord = {
  sha,
  parents: [parent],
  message: 'Selected update',
  authorName: 'Fixture',
  authorEmail: 'fixture@example.test',
  authorDate: null,
  commitDate: null,
};
const history: PanelBody = {
  kind: 'history',
  repository,
  scope: { kind: 'head' },
  text: '',
  append: false,
  page: {
    commits: [commit],
    refs: [],
    nextCursor: null,
    scopeId: 'fixture',
  },
};

function fixture(
  selection: RestorableView['selection'] = {
    sha,
    parentSha: parent,
    filePath: 'sample.txt',
  },
  initialHistory = true,
  preferences: Partial<RestorableView> = {},
) {
  const requests: Request<RequestBody>[] = [];
  const saved: RestorableView = {
    repositoryId: repository.id,
    activeView: 'log',
    scope: { kind: 'head' },
    text: '',
    selectedRefId: null,
    selection,
    anchor: null,
    paneWidths: [220, 350],
    ...preferences,
  };
  const target = new EventTarget();
  const api = {
    getState: () => saved,
    setState: vi.fn(),
    postMessage: (request: Request<RequestBody>) => requests.push(request),
  };
  const bridge = createBrowserBridge(api, target);

  onTestFinished(() => bridge.dispose());
  const hook = renderHook(() => useBrowserState(bridge));
  const deliver = (
    body: PanelBody,
    generation: number,
    requestId = 'host',
    repositoryId = repository.id,
  ) =>
    act(() => {
      target.dispatchEvent(
        new MessageEvent('message', {
          data: { body, generation, requestId, repositoryId },
        }),
      );
    });
  const restores = () =>
    requests.filter((request) => request.body.kind === 'restore');

  deliver(
    { kind: 'setup', state: 'ready', message: '', repositories: [repository] },
    0,
  );
  if (initialHistory) deliver(history, 1, 'select-repository');

  return { ...hook, api, bridge, requests, restores, deliver };
}

test('saved Worktrees stays active from mounting through setup and history restoration', () => {
  const f = fixture(null, false, { activeView: 'worktrees' });

  expect(f.result.current.state.activeView).toBe('worktrees');
  f.deliver(
    { kind: 'setup', state: 'ready', message: '', repositories: [repository] },
    0,
    'startup',
    '',
  );
  expect(f.result.current.state.activeView).toBe('worktrees');
  expect(
    f.requests.filter(({ body }) => body.kind === 'worktrees'),
  ).toHaveLength(0);
  f.deliver(history, 1);
  expect(f.result.current.state.activeView).toBe('worktrees');
  const restore = f.restores()[0]!;

  f.deliver(
    {
      kind: 'selection',
      sha: null,
      parentSha: null,
      filePath: null,
      anchor: null,
    },
    1,
    restore.requestId,
  );
  expect(
    f.requests.filter(({ body }) => body.kind === 'worktrees'),
  ).toHaveLength(1);
  expect(f.api.setState).toHaveBeenLastCalledWith(
    expect.objectContaining({ activeView: 'worktrees' }),
  );
  f.unmount();
});

test.each([null, 'missing'])(
  'saved Worktrees loads the available repository when saved repository is %s',
  (repositoryId) => {
    const f = fixture(null, false, { activeView: 'worktrees', repositoryId });

    f.deliver(history, 1);
    expect(f.result.current.state.activeView).toBe('worktrees');
    expect(
      f.requests.filter(({ body }) => body.kind === 'worktrees'),
    ).toHaveLength(1);
    expect(f.restores()).toHaveLength(0);
    f.unmount();
  },
);

test.each(['one', 'missing'])(
  'saved Worktrees loads even if initial history fails for saved repository %s',
  (repositoryId) => {
    const f = fixture(null, false, { activeView: 'worktrees', repositoryId });

    f.deliver(
      { kind: 'loading', repository, scope: { kind: 'head' }, text: '' },
      1,
      'startup',
    );
    f.deliver({ kind: 'error', message: 'History unavailable' }, 1, 'startup');
    expect(f.result.current.state.activeView).toBe('worktrees');
    expect(
      f.requests.filter(({ body }) => body.kind === 'worktrees'),
    ).toHaveLength(1);
    expect(f.restores()).toHaveLength(0);
    f.deliver(history, 2, 'refresh');
    if (repositoryId === 'one') {
      const restore = f.restores()[0]!;

      f.deliver(
        {
          kind: 'selection',
          sha: null,
          parentSha: null,
          filePath: null,
          anchor: null,
        },
        2,
        restore.requestId,
      );
      expect(
        f.requests.filter(({ body }) => body.kind === 'worktrees'),
      ).toHaveLength(2);
    }

    f.unmount();
  },
);

test('startup refresh retries the saved selection on each newer history generation and ignores unrelated completion', () => {
  const f = fixture();
  const first = f.restores()[0]!;

  f.deliver(
    {
      kind: 'loading',
      repository,
      scope: { kind: 'head' },
      text: '',
      preserve: true,
    },
    2,
    'refresh',
  );
  f.deliver(history, 2, 'refresh');
  f.deliver(history, 2, 'refresh');
  f.deliver(
    {
      kind: 'selection',
      sha: null,
      parentSha: null,
      filePath: null,
      anchor: null,
    },
    2,
    'refresh',
  );
  f.deliver({ kind: 'error', message: 'Unrelated file read' }, 2, 'file-read');
  expect(f.api.setState).not.toHaveBeenCalled();
  expect(f.restores()).toHaveLength(2);
  const retry = f.restores()[1]!;

  expect(retry).toMatchObject({
    generation: 2,
    body: { selection: { sha, parentSha: parent, filePath: 'sample.txt' } },
  });
  expect(retry.requestId).not.toBe(first.requestId);
  f.deliver({ ...history, restoring: true }, 3, retry.requestId);
  expect(f.restores()).toHaveLength(2);
  f.deliver(
    {
      kind: 'selection',
      sha,
      parentSha: parent,
      filePath: 'sample.txt',
      anchor: null,
    },
    2,
    first.requestId,
  );
  expect(f.api.setState).not.toHaveBeenCalled();
  f.deliver(
    {
      kind: 'selection',
      sha,
      parentSha: parent,
      filePath: 'sample.txt',
      anchor: null,
    },
    3,
    retry.requestId,
  );
  f.deliver({ kind: 'details', commit }, 3, retry.requestId);
  expect(f.result.current.state.selectedSha).toBe(sha);
  expect(f.result.current.state.details).toEqual(commit);
  expect(f.api.setState).toHaveBeenLastCalledWith(
    expect.objectContaining({
      selection: { sha, parentSha: parent, filePath: 'sample.txt' },
    }),
  );
  f.deliver(history, 4, 'refresh');
  expect(f.restores()).toHaveLength(2);
  f.unmount();
});

test.each([
  'selection',
  'query',
  'filters',
  'repository',
  'navigation',
] as const)(
  'newer user %s intent revokes pending saved restoration',
  (intent) => {
    const f = fixture();

    act(() => {
      switch (intent) {
        case 'selection':
          f.result.current.onLogIntent({ kind: 'select-commit', sha });
          break;
        case 'query':
          f.result.current.onLogIntent({ kind: 'search', text: 'new query' });
          break;
        case 'filters':
          f.result.current.onLogIntent({
            kind: 'filters',
            filters: {
              regex: false,
              matchCase: false,
              author: { kind: 'all' },
              date: '24h',
            },
          });
          break;
        case 'repository':
          f.result.current.request({ kind: 'choose-repository' });
          break;
        case 'navigation':
          f.result.current.request({ kind: 'go-to', input: parent });
          break;
      }
    });
    f.deliver(history, 2, 'refresh');
    expect(f.restores()).toHaveLength(1);
    f.unmount();
  },
);

test.each(['empty', 'error'] as const)(
  'owned %s restoration settles without retry loops',
  (outcome) => {
    const f = fixture(outcome === 'empty' ? null : undefined);
    const restore = f.restores()[0]!;

    f.deliver({ ...history, restoring: true }, 2, restore.requestId);
    f.deliver(
      outcome === 'empty'
        ? {
            kind: 'selection',
            sha: null,
            parentSha: null,
            filePath: null,
            anchor: null,
          }
        : { kind: 'error', message: 'Saved result unavailable' },
      2,
      restore.requestId,
    );
    f.deliver({ kind: 'history-settled' }, 2, restore.requestId);
    expect(f.api.setState).toHaveBeenCalled();
    expect(f.result.current.state.loading).toBe(false);
    f.deliver(history, 3, 'refresh');
    expect(f.restores()).toHaveLength(1);
    f.unmount();
  },
);

test.each(['repository', 'generation'] as const)(
  'an obsolete restoration error from another %s cannot release saved state',
  (mismatch) => {
    const f = fixture();
    const first = f.restores()[0]!;

    f.deliver(
      { kind: 'error', message: 'Obsolete response' },
      mismatch === 'generation' ? 0 : 1,
      first.requestId,
      mismatch === 'repository' ? 'two' : repository.id,
    );
    expect(f.api.setState).not.toHaveBeenCalled();
    f.deliver(history, 2, 'refresh');
    expect(f.restores()).toHaveLength(2);
    f.unmount();
  },
);

test('an owned restore error before the first loading response releases restoration', () => {
  const f = fixture();
  const restore = f.restores()[0]!;

  // Ref validation may fail after the host advances, before it publishes loading.
  f.deliver(
    { kind: 'error', message: 'Cannot read saved reference' },
    2,
    restore.requestId,
  );
  expect(f.result.current.state.error).toBe('Cannot read saved reference');
  expect(f.api.setState).toHaveBeenCalled();
  f.deliver(history, 2, 'refresh');
  expect(f.restores()).toHaveLength(1);
  f.unmount();
});

test('newer Worktrees navigation waits for a current repository before requesting its list', () => {
  const f = fixture(undefined, false);
  const worktrees = () =>
    f.requests.filter((request) => request.body.kind === 'worktrees');

  act(() => f.result.current.setActiveView('worktrees'));
  expect(worktrees()).toHaveLength(0);
  f.deliver(
    {
      kind: 'loading',
      repository,
      scope: { kind: 'head' },
      text: '',
    },
    1,
    'select-repository',
  );
  f.deliver(history, 1, 'select-repository');
  expect(f.result.current.state.activeView).toBe('worktrees');
  expect(f.restores()).toHaveLength(0);
  expect(worktrees()).toEqual([
    expect.objectContaining({ repositoryId: repository.id, generation: 1 }),
  ]);
  f.deliver(
    {
      kind: 'worktrees',
      worktrees: [
        {
          id: 'main-tree',
          name: 'Main',
          rootUri: repository.rootUri,
          branch: 'main',
          current: true,
          available: true,
        },
      ],
    },
    1,
    worktrees()[0]!.requestId,
  );
  expect(f.result.current.state.worktrees[0]?.id).toBe('main-tree');
  f.unmount();
});

test('returning to Log cancels a deferred Worktrees request before the repository is ready', () => {
  const f = fixture(undefined, false);

  act(() => {
    f.result.current.setActiveView('worktrees');
    f.result.current.setActiveView('log');
  });
  f.deliver(history, 1, 'select-repository');
  expect(f.result.current.state.activeView).toBe('log');
  expect(
    f.requests.filter((request) => request.body.kind === 'worktrees'),
  ).toEqual([]);
  f.unmount();
});

test('saved initial Worktrees navigation requests the restored repository generation', () => {
  const f = fixture(undefined, false, { activeView: 'worktrees' });

  f.deliver(history, 1, 'select-repository');
  const restore = f.restores()[0]!;

  expect(
    f.requests.filter((request) => request.body.kind === 'worktrees'),
  ).toEqual([]);
  f.deliver({ ...history, restoring: true }, 2, restore.requestId);
  f.deliver(
    {
      kind: 'selection',
      sha,
      parentSha: parent,
      filePath: 'sample.txt',
      anchor: null,
    },
    2,
    restore.requestId,
  );
  expect(f.result.current.state.activeView).toBe('worktrees');
  expect(
    f.requests.filter((request) => request.body.kind === 'worktrees'),
  ).toEqual([
    expect.objectContaining({ repositoryId: repository.id, generation: 2 }),
  ]);
  act(() => {
    f.result.current.setActiveView('log');
    f.result.current.setActiveView('worktrees');
  });
  expect(
    f.requests.filter((request) => request.body.kind === 'worktrees'),
  ).toHaveLength(2);
  f.unmount();
});

test('a newer branch selection survives the refresh that supersedes saved restoration', () => {
  const refs = [
    {
      id: 'refs/heads/main',
      name: 'main',
      kind: 'local' as const,
      sha,
      remote: null,
    },
    {
      id: 'refs/heads/other',
      name: 'other',
      kind: 'local' as const,
      sha: parent,
      remote: null,
    },
  ];
  const nextHistory = { ...history, page: { ...history.page, refs } };
  const f = fixture(undefined, false, { selectedRefId: refs[0]!.id });

  f.deliver(nextHistory, 1, 'select-repository');
  act(() =>
    f.result.current.onLogIntent({ kind: 'select-ref', refId: refs[1]!.id }),
  );
  f.deliver(nextHistory, 2, 'refresh');
  expect(f.result.current.state.selectedRefId).toBe(refs[1]!.id);
  expect(f.restores()).toHaveLength(1);
  expect(f.api.setState).toHaveBeenLastCalledWith(
    expect.objectContaining({ selectedRefId: refs[1]!.id }),
  );
  f.unmount();
});

test('a correlated ref-read failure before restore loading visibly settles the newer generation', () => {
  const f = fixture();

  f.deliver({ ...history, restoring: true }, 2, 'refresh');
  const retry = f.restores()[1]!;

  // reload's finally runs before handle publishes this reference-read error.
  f.deliver({ kind: 'history-settled' }, 3, retry.requestId);
  f.deliver(
    { kind: 'error', message: 'Cannot read saved reference' },
    3,
    retry.requestId,
  );
  expect(f.result.current.state).toMatchObject({
    generation: 3,
    error: 'Cannot read saved reference',
    loading: false,
    restoring: false,
  });
  expect(f.api.setState).toHaveBeenCalled();
  f.deliver(history, 4, 'refresh');
  expect(f.restores()).toHaveLength(2);
  f.unmount();
});

test.each(['request', 'repository', 'generation', 'intent'] as const)(
  'an error with obsolete %s ownership cannot settle a restoring view',
  (mismatch) => {
    const f = fixture();

    f.deliver({ ...history, restoring: true }, 2, 'refresh');
    const retry = f.restores()[1]!;

    if (mismatch === 'intent') act(() => f.result.current.setActiveView('log'));
    f.deliver(
      { kind: 'error', message: 'Unrelated result' },
      mismatch === 'generation' ? 1 : 3,
      mismatch === 'request' ? 'unrelated' : retry.requestId,
      mismatch === 'repository' ? 'two' : repository.id,
    );
    expect(f.result.current.state).toMatchObject({
      generation: 2,
      loading: true,
      restoring: true,
    });
    f.unmount();
  },
);

test('the deferred Worktrees request reaches the actual controller with its current repository', async () => {
  const f = fixture(undefined, false);
  const reads: string[] = [];
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  onTestFinished(release);
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const host = controllerFixture(true, true, {
    send: (message) => {
      f.deliver(
        message.body,
        message.generation,
        message.requestId,
        message.repositoryId,
      );
      if (message.body.kind === 'setup' && message.body.state === 'ready')
        act(() => f.result.current.setActiveView('worktrees'));
    },
  });

  onTestFinished(() => host.controller.dispose());
  const historyRead = host.adapter.history;

  host.adapter.history = async (...args) => {
    entered();
    await blocked;

    return historyRead(...args);
  };

  host.adapter.worktrees = async (id) => {
    reads.push(id);

    return [
      {
        id: 'main-tree',
        name: 'Main',
        rootUri: repository.rootUri,
        branch: 'main',
        current: true,
        available: true,
      },
    ];
  };

  try {
    expect(
      f.requests.filter((request) => request.body.kind === 'worktrees'),
    ).toEqual([]);
    const ready = host.controller.handle(f.requests[0]!);

    await started;
    const worktrees = f.requests.filter(
      (request) => request.body.kind === 'worktrees',
    );

    expect(worktrees).toHaveLength(1);
    await host.controller.handle(worktrees[0]!);
    release();
    await ready;
    expect(reads).toEqual([repository.id]);
    expect(f.result.current.state.activeView).toBe('worktrees');
    expect(f.result.current.state.worktrees[0]?.id).toBe('main-tree');
  } finally {
    release();
    host.controller.dispose();
    f.unmount();
  }
});

test('the actual controller ref-read failure visibly ends a pending refresh restoration', async () => {
  const f = fixture(undefined, false, {
    scope: { kind: 'ref', refId: 'refs/heads/main' },
  });
  let release!: () => void;
  let shown!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  onTestFinished(release);
  const visible = new Promise<void>((resolve) => {
    shown = resolve;
  });
  const host = controllerFixture(true, true, {
    send: async (message) => {
      f.deliver(
        message.body,
        message.generation,
        message.requestId,
        message.repositoryId,
      );
      if (message.body.kind === 'history' && message.requestId === 'refresh') {
        shown();
        await blocked;
      }
    },
  });

  onTestFinished(() => host.controller.dispose());

  try {
    await host.controller.selectRepository(repository.id);
    const refreshing = host.controller.refresh();

    await visible;
    const retry = f.restores()[1]!;

    host.adapter.references = async () => {
      throw new Error('Cannot read saved reference');
    };

    await host.controller.handle(retry);
    release();
    await refreshing;
    expect(f.result.current.state).toMatchObject({
      generation: 3,
      error: 'Cannot read saved reference',
      loading: false,
      restoring: false,
    });
    expect(f.restores()).toHaveLength(2);
  } finally {
    release();
    host.controller.dispose();
    f.unmount();
  }
});
