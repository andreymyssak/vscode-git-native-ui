import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import type { FileIconThemeMessage } from '../../shared/file-icons';
import { isRecord } from '../../shared/validation';
import { FileIconSession } from './file-icon-session';
import {
  installedIconThemeRoots,
  readInstalledIconTheme,
} from './file-icon-source';
import { FileIconStyles } from './file-icon-styles';
import { iconResourcePath } from './file-icon-theme';

export async function safeIconResource(
  root: vscode.Uri,
  path: string,
  maximumBytes = 8_388_608,
): Promise<vscode.Uri | null> {
  const normalized = iconResourcePath('package.json', path);

  if (normalized === null) return null;
  try {
    let uri = root;
    const parts = normalized.split('/');
    const rootStat = await vscode.workspace.fs.stat(root);

    if (
      !(rootStat.type & vscode.FileType.Directory) ||
      rootStat.type & vscode.FileType.SymbolicLink
    )
      return null;
    for (const [index, part] of parts.entries()) {
      uri = vscode.Uri.joinPath(uri, part);
      const stat = await vscode.workspace.fs.stat(uri);

      if (stat.type & vscode.FileType.SymbolicLink) return null;
      if (index < parts.length - 1) {
        if (!(stat.type & vscode.FileType.Directory)) return null;
      } else if (
        !(stat.type & vscode.FileType.File) ||
        stat.size > maximumBytes
      )
        return null;
    }

    return uri;
  } catch {
    return null;
  }
}

export function attachFileIcons(
  webview: vscode.Webview,
  storage: vscode.Uri,
  dist: vscode.Uri,
) {
  const nonce = randomBytes(8).toString('hex');
  const directory = vscode.Uri.joinPath(storage, 'file-icon-themes', nonce);
  const installedExtensions = () =>
    vscode.extensions.all.map((extension) => {
      const manifest: unknown = extension.packageJSON;

      return {
        root: extension.extensionUri.toString(),
        contributions: isRecord(manifest) ? manifest.contributes : undefined,
      };
    });
  const roots = new Set(installedIconThemeRoots(installedExtensions()));

  // Changing public webview options recreates its document. Fix access before
  // HTML is assigned; a new or relocated theme owner needs a fresh view.
  webview.options = {
    ...webview.options,
    localResourceRoots: [
      dist,
      directory,
      ...[...roots].map((root) => vscode.Uri.parse(root)),
    ],
  };
  const pending = new Set<Promise<FileIconThemeMessage | null>>();
  let closed = false;
  let sequence = 0;
  const styles = new FileIconStyles({
    write: async (name, css) => {
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(directory, name),
        new TextEncoder().encode(css),
      );
    },
    remove: async (name) =>
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(directory, name)),
  });
  const load = async (): Promise<FileIconThemeMessage | null> => {
    const generation = styles.begin();
    const prefix = `git-file-theme-${nonce}-${++sequence}`;
    const colorKind = vscode.window.activeColorTheme.kind;
    const variant =
      colorKind === vscode.ColorThemeKind.Light ||
      colorKind === vscode.ColorThemeKind.HighContrastLight
        ? 'light'
        : colorKind === vscode.ColorThemeKind.HighContrast
          ? 'highContrast'
          : 'dark';
    const selectedId = vscode.workspace
      .getConfiguration('workbench')
      .get<string | null>('iconTheme', null);
    const result = await readInstalledIconTheme({
      selectedId,
      prefix,
      variant,
      extensions: installedExtensions(),
      fileAssociations: vscode.workspace
        .getConfiguration('files')
        .get<Record<string, string>>('associations', {}),
      read: async (root, path) => {
        if (!roots.has(root)) return null;
        const uri = await safeIconResource(
          vscode.Uri.parse(root),
          path,
          4_194_304,
        );

        if (!uri) return null;
        const bytes = await vscode.workspace.fs.readFile(uri);

        return bytes.length <= 4_194_304
          ? new TextDecoder().decode(bytes)
          : null;
      },
      resource: async (root, path) => {
        if (!roots.has(root)) return null;
        const uri = await safeIconResource(vscode.Uri.parse(root), path);

        return uri ? webview.asWebviewUri(uri).toString() : null;
      },
    });

    if (!result || closed) return null;
    let stylesheet: string | null = null;

    if (result.css) {
      const styleFile = await styles.save(generation, prefix, result.css);

      if (!styleFile) return null;
      stylesheet = webview
        .asWebviewUri(vscode.Uri.joinPath(directory, styleFile))
        .toString();
    }

    return { kind: 'file-icon-theme', theme: result.theme, stylesheet };
  };

  const session = new FileIconSession<FileIconThemeMessage>({
    load: async () => {
      const work = load();

      pending.add(work);
      try {
        return await work;
      } finally {
        pending.delete(work);
      }
    },
    publish: async (value) => {
      if (closed) return;
      await webview.postMessage({
        requestId: 'file-icons',
        repositoryId: '',
        generation: 0,
        body: value ?? {
          kind: 'file-icon-theme',
          theme: null,
          stylesheet: null,
        },
      });
      await styles.prune();
    },
  });
  const refresh = () => {
    void session.refresh();
  };

  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration('workbench.iconTheme') ||
      event.affectsConfiguration('files.associations')
    )
      refresh();
  });
  const color = vscode.window.onDidChangeActiveColorTheme(refresh);
  const extensions = vscode.extensions.onDidChange(refresh);

  refresh();

  return {
    ready: () => session.ready(),
    dispose: () => {
      closed = true;
      session.dispose();
      configuration.dispose();
      color.dispose();
      extensions.dispose();
      void Promise.allSettled([...pending])
        .then(() => styles.dispose())
        .then(() =>
          vscode.workspace.fs.delete(directory, {
            recursive: true,
            useTrash: false,
          }),
        )
        .catch(() => undefined);
    },
  };
}
