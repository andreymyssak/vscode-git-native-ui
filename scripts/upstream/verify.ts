import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadManifest, reproduce, safePath } from './reproduce.ts';

export async function verify(manifestPath: string): Promise<void> {
  const { manifest, root } = await loadManifest(manifestPath);
  const temporary = await mkdtemp(
    join(tmpdir(), 'git-native-ui-reproduction-'),
  );

  try {
    await reproduce(manifestPath, temporary);
    for (const output of manifest.outputs) {
      const actual = await readFile(safePath(root, output.path));

      if (/(?:from\s*|import\s*)['"]vs\//.test(actual.toString()))
        throw new Error('Forbidden private import');
      const expected = await readFile(safePath(temporary, output.path));

      if (!actual.equals(expected))
        throw new Error(`Generated output differs: ${output.path}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await verify(resolve(process.argv[2] ?? 'upstream/vscode/manifest.json'));
  console.log('Upstream hashes, patches and generated output verified.');
}
