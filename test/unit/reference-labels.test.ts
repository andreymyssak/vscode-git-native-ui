import { expect, test } from 'vitest';

import { buildReferenceLabels } from '../../src/webview/pages/log/model/reference-labels';

test('current local reference leads while markers represent distinct kinds', () => {
  const repo = {
    id: 'one',
    label: 'One',
    rootUri: 'file:///one',
    branch: 'main',
    headSha: 'a',
  };
  const refs = [
    {
      id: 'refs/tags/v2',
      name: 'v2',
      sha: 'a',
      kind: 'tag' as const,
      remote: null,
    },
    {
      id: 'refs/remotes/origin/main',
      name: 'origin/main',
      sha: 'a',
      kind: 'remote' as const,
      remote: 'origin',
    },
    {
      id: 'refs/heads/topic10',
      name: 'topic10',
      sha: 'a',
      kind: 'local' as const,
      remote: null,
    },
    {
      id: 'refs/heads/topic2',
      name: 'topic2',
      sha: 'a',
      kind: 'local' as const,
      remote: null,
    },
    {
      id: 'refs/heads/main',
      name: 'main',
      sha: 'a',
      kind: 'local' as const,
      remote: null,
    },
  ];
  const labels = buildReferenceLabels(refs, repo, 'a');

  expect(labels.summary).toBe('main');
  expect(labels.markers.map((label) => label.kind)).toStrictEqual([
    'head',
    'local',
    'remote',
  ]);
  expect(labels.labels.map((label) => label.name)).toStrictEqual([
    'HEAD',
    'main',
    'topic2',
    'topic10',
    'origin/main',
    'v2',
  ]);
  expect(labels.accessibleLabel).toMatch(
    /Remote-tracking branch: origin\/main/,
  );
});
