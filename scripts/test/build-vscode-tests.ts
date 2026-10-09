import { glob, rm } from 'node:fs/promises';

import { build } from 'esbuild';

await rm('dist/test', { recursive: true, force: true });
const files = await Array.fromAsync(
  glob(['test/vscode/**/*.test.ts', 'test/vscode/**/*.scenario.ts']),
);

if (files.length)
  await build({
    entryPoints: files,
    outdir: 'dist/test',
    outbase: 'test',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    external: ['vscode', '@playwright/test', 'esbuild'],
    sourcemap: true,
  });
