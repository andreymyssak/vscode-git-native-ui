import type {
  IndentGuideDisplay,
  VscodeTree,
} from '@vscode-elements/elements/dist/vscode-tree/vscode-tree.js';
import type { VscodeTreeItem } from '@vscode-elements/elements/dist/vscode-tree-item/vscode-tree-item.js';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'vscode-tree': DetailedHTMLProps<
        HTMLAttributes<VscodeTree>,
        VscodeTree
      > & {
        indent?: number;
        indentGuides?: IndentGuideDisplay;
        multiSelect?: boolean;
      };
      'vscode-tree-item': DetailedHTMLProps<
        HTMLAttributes<VscodeTreeItem>,
        VscodeTreeItem
      > & { open?: boolean; selected?: boolean };
    }
  }
}
