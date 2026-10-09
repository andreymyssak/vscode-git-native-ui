import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { PanelBody, Result } from '../../src/shared/messages';
import type { ViewState } from '../../src/webview/app/model/state';
import { initialView, reduceView } from '../../src/webview/app/model/state';
import { useHistoryPaging } from '../../src/webview/pages/log/model/useHistoryPaging';

const repository = {
  id: 'one',
  label: 'One',
  rootUri: 'file:///one',
  branch: 'main',
  headSha: 'a'.repeat(40),
};
const commits = Array.from({ length: 400 }, (_, index) => ({
  sha: (index + 1).toString(16).padStart(40, '0'),
  parents: [],
  message: 'Commit',
  authorName: null,
  authorEmail: null,
  authorDate: null,
  commitDate: null,
}));
const message = (body: PanelBody, generation = 2): Result<PanelBody> => ({
  repositoryId: 'one',
  requestId: 'test',
  generation,
  body,
});
const history = (append: boolean, restoring: boolean): PanelBody => ({
  kind: 'history',
  append,
  restoring,
  repository,
  scope: { kind: 'head' },
  text: '',
  page: {
    commits: append ? commits.slice(200) : commits.slice(0, 200),
    refs: [],
    nextCursor: append ? 'cursor-400' : 'cursor-200',
    scopeId: 'fixture',
  },
});

test('auto paging waits through restoring pages and requests only the remaining cursor after settlement', () => {
  const onIntent = vi.fn();
  let data: ViewState = {
    ...initialView(),
    repository,
    generation: 1,
    scrollTop: 8500,
  };

  data = reduceView(data, {
    kind: 'host',
    message: message({
      kind: 'loading',
      repository,
      scope: data.scope,
      text: '',
      preserve: true,
    }),
  });
  const { rerender } = renderHook(
    ({ state }) => useHistoryPaging(state, 200, onIntent),
    { initialProps: { state: data } },
  );

  data = reduceView(data, {
    kind: 'host',
    message: message(history(false, true)),
  });
  rerender({ state: data });
  expect(onIntent).not.toHaveBeenCalled();
  data = reduceView(data, {
    kind: 'host',
    message: message(history(true, true)),
  });
  rerender({ state: data });
  expect(onIntent).not.toHaveBeenCalled();
  data = reduceView(data, {
    kind: 'host',
    message: message({ kind: 'history-settled' }),
  });
  rerender({ state: data });
  expect(onIntent).toHaveBeenCalledExactlyOnceWith({
    kind: 'request',
    body: {
      kind: 'history',
      scope: data.scope,
      text: '',
      filters: data.filters,
      cursor: 'cursor-400',
    },
  });
  rerender({ state: { ...data, scrollTop: 8501 } });
  expect(onIntent).toHaveBeenCalledTimes(1);
});

test('normal first-page history immediately permits near-end automatic paging', () => {
  const onIntent = vi.fn();
  const data = reduceView(
    { ...initialView(), repository, scrollTop: 4200 },
    {
      kind: 'host',
      message: message(history(false, false)),
    },
  );

  renderHook(() => useHistoryPaging(data, 200, onIntent));
  expect(onIntent).toHaveBeenCalledExactlyOnceWith({
    kind: 'request',
    body: {
      kind: 'history',
      scope: data.scope,
      text: '',
      filters: data.filters,
      cursor: 'cursor-200',
    },
  });
});

test('settlement from another generation or repository cannot release current paging', () => {
  const onIntent = vi.fn();
  let data = reduceView(
    { ...initialView(), repository, scrollTop: 4200 },
    {
      kind: 'host',
      message: message(history(false, true)),
    },
  );
  const { rerender } = renderHook(
    ({ state }) => useHistoryPaging(state, 200, onIntent),
    { initialProps: { state: data } },
  );

  for (const result of [
    message({ kind: 'history-settled' }, 1),
    message({ kind: 'history-settled' }, 3),
    { ...message({ kind: 'history-settled' }), repositoryId: 'two' },
  ]) {
    data = reduceView(data, { kind: 'host', message: result });
    rerender({ state: data });
  }

  expect(onIntent).not.toHaveBeenCalled();
  data = reduceView(data, {
    kind: 'host',
    message: message({ kind: 'history-settled' }),
  });
  rerender({ state: data });
  expect(onIntent).toHaveBeenCalledTimes(1);
});

test('an unrelated request error cannot hand paging ownership away during restoration', () => {
  const onIntent = vi.fn();
  let data = reduceView(
    { ...initialView(), repository, scrollTop: 4200 },
    {
      kind: 'host',
      message: message(history(false, true)),
    },
  );
  const { rerender } = renderHook(
    ({ state }) => useHistoryPaging(state, 200, onIntent),
    { initialProps: { state: data } },
  );

  data = reduceView(data, {
    kind: 'host',
    message: message({ kind: 'error', message: 'File unavailable' }),
  });
  rerender({ state: data });
  expect(data.error).toBe('File unavailable');
  expect(onIntent).not.toHaveBeenCalled();
  data = reduceView(data, {
    kind: 'host',
    message: message({ kind: 'history-settled' }),
  });
  rerender({ state: data });
  expect(onIntent).toHaveBeenCalledTimes(1);
});
