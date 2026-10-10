import type {
  BranchActionKind,
  CommitActionKind,
  WorktreeActionKind,
} from './messages';

/** The build injects only identity metadata from package.json. */
declare const __EXTENSION_IDENTITY__: {
  readonly name: string;
  readonly publisher: string;
  readonly displayName: string;
  readonly commandNamespace: string;
};

export const extensionIdentity = Object.freeze(__EXTENSION_IDENTITY__);

export const EXTENSION_ID = `${extensionIdentity.publisher}.${extensionIdentity.name}`;
export const LOG_VIEW_ID = `${extensionIdentity.commandNamespace}.log`;
export const EMPTY_DOCUMENT_SCHEME = `${extensionIdentity.name}-empty`;
export const SQUASH_RECOVERY_OWNER = `${extensionIdentity.name}-squash`;
export const SQUASH_HELPER_ID = `${SQUASH_RECOVERY_OWNER}-helper`;
export const RENDER_MEASUREMENT = `${extensionIdentity.name}.render`;

export function commandId(
  kind: BranchActionKind | CommitActionKind | WorktreeActionKind,
): string {
  return `${extensionIdentity.commandNamespace}.${kind}`;
}
