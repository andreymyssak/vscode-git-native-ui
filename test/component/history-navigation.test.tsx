import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { initialView, reduceView } from '../../src/webview/app/model/state';
import { HistoryPane } from '../../src/webview/pages/log/ui/history/HistoryPane';

const commits = Array.from({ length: 3 }, (_, index) => ({
  sha: (index + 1).toString(16).padStart(40, '0'),
  parents: [],
  message: 'Commit',
  authorName: null,
  authorEmail: null,
  authorDate: null,
  commitDate: null,
}));

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => vi.unstubAllGlobals());

test('grid keyboard navigation targets the active commit rather than the scrolled viewport and preserves Shift', () => {
  const onIntent = vi.fn();
  const data = reduceView(
    { ...initialView(), commits, scrollTop: 22000 },
    {
      kind: 'select-commit',
      sha: commits[1]!.sha,
    },
  );

  render(<HistoryPane data={data} onIntent={onIntent} />);
  fireEvent.keyDown(screen.getByRole('grid'), {
    key: 'ArrowDown',
    shiftKey: true,
  });
  expect(onIntent).toHaveBeenCalledExactlyOnceWith({
    kind: 'select-commit',
    sha: commits[2]!.sha,
    scrollTop: 44,
    gesture: 'extend',
  });
});

test('a grid without an active selection starts at the first loaded commit', () => {
  const onIntent = vi.fn();

  render(
    <HistoryPane data={{ ...initialView(), commits }} onIntent={onIntent} />,
  );
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowUp' });
  expect(onIntent).toHaveBeenCalledExactlyOnceWith({
    kind: 'select-commit',
    sha: commits[0]!.sha,
    scrollTop: 0,
    gesture: 'plain',
  });
});

test('empty-grid arrows never emit a selection', () => {
  const onIntent = vi.fn();

  render(<HistoryPane data={initialView()} onIntent={onIntent} />);
  fireEvent.keyDown(screen.getByRole('grid'), {
    key: 'ArrowDown',
    shiftKey: true,
  });
  fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowUp' });
  expect(onIntent).not.toHaveBeenCalled();
});
