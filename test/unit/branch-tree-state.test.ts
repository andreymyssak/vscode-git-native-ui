import { expect, test } from 'vitest';

import {
  buildBranchTree,
  currentBranchAncestors,
  resolveExpansion,
} from '../../src/webview/pages/log/model/branch-tree-state';

test('only current local ancestors expand initially and branches use natural order', () => {
  const refs = [
    'topic10',
    'topic2',
    'feature/team/topic',
    'feature/team/another',
  ].map((name) => ({
    id: 'refs/heads/' + name,
    name,
    kind: 'local' as const,
    sha: 'a',
    remote: null,
  }));
  const nodes = buildBranchTree(refs, 'feature/team/topic', '');

  expect(nodes.map((node) => node.name)).toStrictEqual([
    'All branches',
    'HEAD (Current Branch)',
    'Local',
    'Remote',
    'Tags',
  ]);
  expect(nodes[0]?.scope).toStrictEqual({ kind: 'all' });
  expect(nodes[0]?.reference).toBe(null);
  expect(currentBranchAncestors('feature/team/topic')).toStrictEqual([
    'group:local',
    'folder:local:feature/',
    'folder:local:feature/team/',
  ]);
  const expansion = resolveExpansion(
    nodes,
    new Map(),
    'feature/team/topic',
    false,
  );

  expect(expansion.get('group:local')).toBe(true);
  expect(expansion.get('group:remote')).toBe(false);
  expect(expansion.get('group:tag')).toBe(false);
  expect(nodes[2]!.children.map((node) => node.name)).toStrictEqual([
    'feature',
    'topic2',
    'topic10',
  ]);
  const team = nodes[2]!.children[0]!.children[0]!;

  expect(team.children[0]?.name).toBe('topic');
  const remembered = new Map([['group:local', false]]);

  expect(
    resolveExpansion(nodes, remembered, 'feature/team/topic', false).get(
      'group:local',
    ),
  ).toBe(false);
  expect(
    resolveExpansion(nodes, remembered, 'feature/team/topic', true).get(
      'group:local',
    ),
  ).toBe(true);
  expect(
    resolveExpansion(nodes, remembered, 'feature/team/topic', false).get(
      'group:local',
    ),
  ).toBe(false);
  expect(buildBranchTree(refs, null, 'team/topic')[0]?.name).toBe('Local');
});
