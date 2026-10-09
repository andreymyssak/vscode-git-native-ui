import type { Reference, Scope } from '@contracts/model';

export interface BranchNode {
  id: string;
  name: string;
  depth: number;
  reference: Reference | null;
  scope: Scope | null;
  children: BranchNode[];
  current: boolean;
}
const names = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});
const node = (id: string, name: string, depth = 0): BranchNode => ({
  id,
  name,
  depth,
  reference: null,
  scope: null,
  children: [],
  current: false,
});

export function currentBranchAncestors(branch: string | null): string[] {
  if (!branch) return [];
  let path = '';

  return [
    'group:local',
    ...branch
      .split('/')
      .slice(0, -1)
      .map((part) => {
        path += part + '/';

        return 'folder:local:' + path;
      }),
  ];
}

export function buildBranchTree(
  refs: readonly Reference[],
  branch: string | null,
  query: string,
): BranchNode[] {
  const filter = query.trim().toLocaleLowerCase();
  const roots: BranchNode[] = [];

  if (!filter) {
    const all = node('scope:all', 'All branches');

    all.scope = { kind: 'all' };
    roots.push(all);
    const head = node('scope:head', 'HEAD (Current Branch)');

    head.scope = { kind: 'head' };
    roots.push(head);
  }

  for (const [kind, label] of [
    ['local', 'Local'],
    ['remote', 'Remote'],
    ['tag', 'Tags'],
  ] as const) {
    const matching = refs.filter(
      (ref) =>
        ref.kind === kind && ref.name.toLocaleLowerCase().includes(filter),
    );

    if (filter && !matching.length) continue;
    const root = node('group:' + kind, label);

    roots.push(root);
    for (const ref of matching) {
      const parts = ref.name.split('/');
      let parent = root;
      let path = '';

      for (const [index, part] of parts.slice(0, -1).entries()) {
        path += part + '/';
        const id = 'folder:' + kind + ':' + path;
        let folder = parent.children.find((child) => child.id === id);

        if (!folder) {
          folder = node(id, part, index + 1);
          parent.children.push(folder);
        }

        parent = folder;
      }

      const leaf = node(
        'ref:' + ref.id,
        parts.at(-1) ?? ref.name,
        parts.length,
      );

      leaf.reference = ref;
      leaf.scope = { kind: 'ref', refId: ref.id };
      leaf.current = kind === 'local' && ref.name === branch;
      parent.children.push(leaf);
    }

    const rank = (node: BranchNode) =>
      node.current ? 0 : node.reference ? 2 : 1;
    const sort = (node: BranchNode) => {
      node.children.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          names.compare(
            a.reference?.name ?? a.name,
            b.reference?.name ?? b.name,
          ),
      );
      for (const child of node.children) sort(child);
    };

    sort(root);
  }

  return roots;
}

export function resolveExpansion(
  nodes: readonly BranchNode[],
  remembered: ReadonlyMap<string, boolean>,
  branch: string | null,
  searching: boolean,
): ReadonlyMap<string, boolean> {
  const defaults = new Set(currentBranchAncestors(branch));
  const result = new Map<string, boolean>();
  const visit = (node: BranchNode) => {
    if (!node.reference && !node.scope)
      result.set(
        node.id,
        searching || (remembered.get(node.id) ?? defaults.has(node.id)),
      );
    for (const child of node.children) visit(child);
  };

  for (const node of nodes) visit(node);

  return result;
}
