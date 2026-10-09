import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { UpstreamManifest } from './types.ts';
import { parseManifest } from './validation.ts';

const execute = promisify(execFile);

export function safePath(root: string, path: string): string {
  const result = resolve(root, path);

  if (!result.startsWith(resolve(root) + sep))
    throw new Error(`Path outside owned root: ${path}`);

  return result;
}

export async function loadManifest(
  path: string,
): Promise<{ manifest: UpstreamManifest; root: string }> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  const manifest = parseManifest(value);

  return { manifest, root: resolve(dirname(path), '../..') };
}

export async function reproduce(
  manifestPath: string,
  outputRoot: string,
): Promise<void> {
  const { manifest, root } = await loadManifest(manifestPath);

  await mkdir(outputRoot, { recursive: true });
  if ((await readdir(outputRoot)).length)
    throw new Error('Reproduction requires an empty output directory');
  for (const input of manifest.inputs) {
    const data = await readFile(safePath(root, input.localPath));

    if (createHash('sha256').update(data).digest('hex') !== input.sha256)
      throw new Error(`Input hash mismatch: ${input.path}`);
    if (input.role === 'copied') {
      const target = safePath(outputRoot, input.path);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
  }

  for (const patch of manifest.patches) {
    const path = safePath(root, patch.path);

    if (
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex') !== patch.sha256
    )
      throw new Error(`Patch hash mismatch: ${patch.path}`);
    await execute('git', ['apply', '--check', path], { cwd: outputRoot });
    await execute('git', ['apply', path], { cwd: outputRoot });
  }

  for (const output of manifest.outputs) {
    const source = safePath(outputRoot, output.sourcePath);
    const code = await readFile(source, 'utf8');

    if (
      /(?:from\s*|import\s*)['"](?:vs\/|(?:\.\.\/)+(?:base|platform|workbench)\/)/.test(
        code,
      )
    )
      throw new Error('Forbidden private import');
    const target = safePath(outputRoot, output.path);

    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await reproduce(
    resolve(process.argv[2] ?? 'upstream/vscode/manifest.json'),
    resolve(process.argv[3] ?? '.artifacts/reproduced'),
  );
