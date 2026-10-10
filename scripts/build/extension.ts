import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { build } from 'esbuild';

import { extensionDefines } from '../shared/extension.ts';

await mkdir('dist', { recursive: true });
await mkdir('.artifacts', { recursive: true });
const [host, squashHelper] = await Promise.all([
  build({
    entryPoints: ['src/extension/activate.ts'],
    outfile: 'dist/extension.cjs',
    bundle: true,
    define: extensionDefines,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    external: ['vscode'],
    sourcemap: true,
    metafile: true,
  }),
  build({
    entryPoints: ['src/extension/git/squash-helper.ts'],
    outfile: 'dist/squash-helper.cjs',
    bundle: true,
    define: extensionDefines,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    metafile: true,
  }),
]);

await Promise.all([
  writeFile(
    '.artifacts/build-host.json',
    JSON.stringify(host.metafile, null, 2),
  ),
  writeFile(
    '.artifacts/build-squash-helper.json',
    JSON.stringify(squashHelper.metafile, null, 2),
  ),
]);
const licenses = [
  '@vscode-elements/elements/LICENSE',
  '@vscode/codicons/LICENSE',
  '@vscode/codicons/LICENSE-CODE',
  'lit/LICENSE',
  'lit-element/LICENSE',
  'lit-html/LICENSE',
  '@lit/reactive-element/LICENSE',
  '@lit/context/LICENSE',
  'react/LICENSE',
  'react-dom/LICENSE',
  'scheduler/LICENSE',
  '@floating-ui/react/LICENSE',
  '@floating-ui/react-dom/LICENSE',
  '@floating-ui/dom/LICENSE',
  '@floating-ui/core/LICENSE',
  '@floating-ui/utils/LICENSE',
  'tabbable/LICENSE',
  'clsx/license',
  '@tanstack/react-virtual/LICENSE',
  '@tanstack/virtual-core/LICENSE',
  'zustand/LICENSE',
  'jsonc-parser/LICENSE.md',
  'picomatch/LICENSE',
];

await writeFile(
  'dist/UI_LICENSES.txt',
  (
    await Promise.all(
      licenses.map(
        async (path) =>
          `${path}\n\n${await readFile(`node_modules/${path}`, 'utf8')}`,
      ),
    )
  ).join('\n\n'),
);
