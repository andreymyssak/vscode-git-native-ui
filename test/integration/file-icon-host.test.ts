import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { assert, expect, test } from 'vitest';
import type * as vscode from 'vscode';

import type { attachFileIcons } from '../../src/extension/panel/file-icon-host';
import type { FileIconThemeMessage } from '../../src/shared/file-icons';

class Uri {
  constructor(private readonly value: URL) {}
  static file(path: string) {
    return new Uri(pathToFileURL(path));
  }

  static parse(value: string) {
    return new Uri(new URL(value));
  }

  static joinPath(root: Uri, ...parts: string[]) {
    return Uri.file(join(root.fsPath, ...parts));
  }

  get fsPath() {
    return fileURLToPath(this.value);
  }

  toString() {
    return this.value.href;
  }
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'git-ui-native-icon-host-'));
  const globalKey = 'iconHost' + directory;
  const globals = globalThis as unknown as Record<string, unknown>;
  let icons: ReturnType<typeof attachFileIcons> | undefined;

  try {
    const first = Uri.file(join(directory, 'first'));
    const second = Uri.file(join(directory, 'second'));
    const added = Uri.file(join(directory, 'added'));
    const dist = Uri.file(join(directory, 'dist'));
    const storage = Uri.file(join(directory, 'storage'));
    const owners = [first, second, added];

    for (const [index, root] of owners.entries()) {
      await mkdir(root.fsPath);
      await writeFile(
        join(root.fsPath, 'theme.json'),
        JSON.stringify({
          iconDefinitions: {
            file: { iconPath: './dark.svg' },
            light: { iconPath: './light.svg' },
          },
          file: 'file',
          light: {
            file: 'light',
          },
        }),
      );
      await writeFile(join(root.fsPath, 'dark.svg'), `<svg>${index}</svg>`);
      await writeFile(join(root.fsPath, 'light.svg'), `<svg>${index}</svg>`);
    }

    let selectedId = 'first';
    let kind = 2;
    const configListeners = new Set<(event: unknown) => void>();
    const colorListeners = new Set<() => void>();
    const extensionListeners = new Set<() => void>();
    const listen =
      <T>(listeners: Set<T>) =>
      (listener: T) => {
        listeners.add(listener);

        return { dispose: () => listeners.delete(listener) };
      };

    const extension = (root: Uri, id: string) => ({
      extensionUri: root,
      packageJSON: {
        contributes: { iconThemes: [{ id, path: './theme.json' }] },
      },
    });
    const installed = [extension(first, 'first'), extension(second, 'second')];

    installed.push({
      extensionUri: Uri.file(join(directory, 'repository')),
      packageJSON: {
        contributes: { iconThemes: [{ id: 'unsafe', path: '../theme.json' }] },
      },
    });
    const reads: string[] = [];
    let removed!: () => void;
    const cleanupComplete = new Promise<void>((resolve) => {
      removed = resolve;
    });
    const runtime = {
      Uri,
      FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
      ColorThemeKind: {
        Light: 1,
        Dark: 2,
        HighContrast: 3,
        HighContrastLight: 4,
      },
      workspace: {
        getConfiguration: (section: string) => ({
          get: () => (section === 'workbench' ? selectedId : {}),
        }),
        onDidChangeConfiguration: listen(configListeners),
        fs: {
          stat: async (uri: Uri) => {
            const value = await stat(uri.fsPath);

            return { type: value.isDirectory() ? 2 : 1, size: value.size };
          },
          readFile: (uri: Uri) => {
            reads.push(uri.toString());

            return readFile(uri.fsPath);
          },
          createDirectory: (uri: Uri) => mkdir(uri.fsPath, { recursive: true }),
          writeFile: (uri: Uri, bytes: Uint8Array) =>
            writeFile(uri.fsPath, bytes),
          delete: async (uri: Uri, options?: { recursive?: boolean }) => {
            await rm(uri.fsPath, { recursive: true, force: true });
            if (options?.recursive) removed();
          },
        },
      },
      window: {
        get activeColorTheme() {
          return { kind };
        },
        onDidChangeActiveColorTheme: listen(colorListeners),
      },
      extensions: { all: installed, onDidChange: listen(extensionListeners) },
    };

    globals[globalKey] = runtime;
    const bundle = join(directory, 'host.mjs');

    await build({
      entryPoints: [resolve('src/extension/panel/file-icon-host.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      plugins: [
        {
          name: 'public-vscode-test-surface',
          setup: (builder) => {
            builder.onResolve({ filter: /^vscode$/ }, () => ({
              path: 'vscode',
              namespace: 'test',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
              contents: `export const { Uri, FileType, ColorThemeKind, workspace, window, extensions } = globalThis[${JSON.stringify(globalKey)}];`,
              loader: 'js',
            }));
          },
        },
      ],
    });
    const host = (await import(pathToFileURL(bundle).href)) as {
      attachFileIcons: typeof attachFileIcons;
    };
    let options: vscode.WebviewOptions = { enableScripts: true };
    const optionWrites: vscode.WebviewOptions[] = [];
    const deliveries: ((message: FileIconThemeMessage) => void)[] = [];
    const webview = {
      get options() {
        return options;
      },
      set options(value: vscode.WebviewOptions) {
        options = value;
        optionWrites.push(value);
      },
      asWebviewUri: (uri: Uri) => ({
        toString: () =>
          'https://webview.test/' + encodeURIComponent(uri.toString()),
      }),
      postMessage: async (message: { body: FileIconThemeMessage }) => {
        deliveries.shift()?.(message.body);

        return true;
      },
    };
    const attached = host.attachFileIcons(
      webview as unknown as vscode.Webview,
      storage as unknown as vscode.Uri,
      dist as unknown as vscode.Uri,
    );

    icons = attached;
    const next = (action: () => void) =>
      new Promise<FileIconThemeMessage>((finish) => {
        deliveries.push(finish);
        action();
      });

    return {
      roots: () => options.localResourceRoots?.map((uri) => uri.toString()),
      optionWrites,
      reads,
      first,
      second,
      added,
      dist,
      initial: () => next(() => attached.ready()),
      theme: (id: string) =>
        next(() => {
          selectedId = id;
          for (const listener of configListeners)
            listener({ affectsConfiguration: () => true });
        }),
      light: () =>
        next(() => {
          kind = 1;
          for (const listener of colorListeners) listener();
        }),
      install: () =>
        next(() => {
          selectedId = 'added';
          installed.push(extension(added, 'added'));
          for (const listener of extensionListeners) listener();
        }),
      move: () =>
        next(() => {
          selectedId = 'first';
          installed[0] = extension(added, 'first');
          for (const listener of extensionListeners) listener();
        }),
      close: async () => {
        attached.dispose();
        await cleanupComplete;
        delete globals[globalKey];
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    icons?.dispose();
    delete globals[globalKey];
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

test('icon roots are ready before content and stay fixed through installed theme and color switches', async () => {
  const view = await harness();

  try {
    const roots = view.roots();

    assert.ok(roots);
    expect(view.optionWrites.length).toBe(1);
    expect(roots[0]).toBe(view.dist.toString());
    expect(roots[1]!).toMatch(/\/storage\/file-icon-themes\/[a-f0-9]+$/);
    expect(roots.slice(2)).toStrictEqual([
      view.first.toString(),
      view.second.toString(),
    ]);
    const initial = await view.initial();

    expect(initial.theme?.definitions.file?.uri ?? '').toMatch(/dark\.svg/);
    const changed = await view.theme('second');

    expect(changed.theme?.definitions.file?.uri ?? '').toMatch(
      /second.*dark\.svg/,
    );
    const light = await view.light();

    expect(light.theme?.definitions.light?.uri ?? '').toMatch(
      /second.*light\.svg/,
    );
    expect(view.roots()).toStrictEqual(roots);
    expect(view.optionWrites.length).toBe(1);
  } finally {
    await view.close();
  }
});
test('a newly installed theme owner uses fallback without adding roots or reading its files', async () => {
  const view = await harness();

  try {
    await view.initial();
    const roots = view.roots();
    const changed = await view.install();

    expect(changed.theme).toBe(null);
    expect(changed.stylesheet).toBe(null);
    expect(view.roots()).toStrictEqual(roots);
    expect(view.optionWrites.length).toBe(1);
    expect(
      view.reads.some((uri) => uri.startsWith(view.added.toString())),
    ).toBe(false);
    const moved = await view.move();

    expect(moved.theme).toBe(null);
    expect(view.roots()).toStrictEqual(roots);
    expect(view.optionWrites.length).toBe(1);
    expect(
      view.reads.some((uri) => uri.startsWith(view.added.toString())),
    ).toBe(false);
  } finally {
    await view.close();
  }
});
