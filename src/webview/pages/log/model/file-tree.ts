import type { FileChange } from '@contracts/model';

export type FileTreeNode =
  | {
      kind: 'folder';
      id: string;
      name: string;
      files: number;
      children: FileTreeNode[];
    }
  | { kind: 'file'; id: string; name: string; change: FileChange };
export function buildFileTree(files: readonly FileChange[]): FileTreeNode[] {
  const tree: FileTreeNode[] = [];

  for (const change of files) {
    const parts = (change.newPath ?? change.oldPath ?? 'File').split('/');
    let nodes = tree;
    let path = '';

    for (const part of parts.slice(0, -1)) {
      path += part + '/';
      let folder = nodes.find(
        (node): node is Extract<FileTreeNode, { kind: 'folder' }> =>
          node.kind === 'folder' && node.name === part,
      );

      if (!folder) {
        folder = {
          kind: 'folder',
          id: 'folder:' + path,
          name: part,
          files: 0,
          children: [],
        };
        nodes.push(folder);
      }

      folder.files++;
      nodes = folder.children;
    }

    nodes.push({
      kind: 'file',
      id: change.id,
      name: parts.at(-1) ?? 'File',
      change,
    });
  }

  return compactAndSort(tree);
}

const names = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function compactAndSort(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes
    .map((node): FileTreeNode => {
      if (node.kind === 'file') return node;
      let folder = node;

      while (
        folder.children.length === 1 &&
        folder.children[0]?.kind === 'folder'
      ) {
        const child = folder.children[0];

        folder = { ...child, name: folder.name + '/' + child.name };
      }

      return { ...folder, children: compactAndSort(folder.children) };
    })
    .sort((left, right) =>
      left.kind !== right.kind
        ? left.kind === 'folder'
          ? -1
          : 1
        : names.compare(left.name, right.name) ||
          left.name.localeCompare(right.name),
    );
}
