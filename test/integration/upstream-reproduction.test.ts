import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { assert, expect, test } from 'vitest';

import { reproduce } from '../../scripts/upstream/reproduce.ts';
import { verify } from '../../scripts/upstream/verify.ts';

const manifest = resolve('upstream/vscode/manifest.json');

test('same inputs reproduce same bytes', async () => {
  const output = await mkdtemp(join(tmpdir(), 'git-native-ui-repro-'));

  try {
    await reproduce(manifest, output);
    const graph = join(output, 'src/vendor/vscode-graph/graph.ts');

    assert.ok(existsSync(graph), 'portable output must be produced');
    expect(readFileSync(graph)).toStrictEqual(
      readFileSync('src/vendor/vscode-graph/graph.ts'),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
for (const mutation of [
  'changed input hash',
  'missing file',
  'patch conflict',
  'forbidden private import',
  'modified generated output',
]) {
  test(`verification rejects ${mutation}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-native-ui-verify-'));

    try {
      await cp('upstream', join(root, 'upstream'), { recursive: true });
      await cp('src/vendor', join(root, 'src/vendor'), { recursive: true });
      const path = join(root, 'upstream/vscode/manifest.json');
      const data = JSON.parse(await readFile(path, 'utf8'));

      if (mutation === 'changed input hash')
        data.inputs[0].sha256 = '0'.repeat(64);
      if (mutation === 'missing file')
        await rm(join(root, data.inputs[0].localPath));
      if (mutation === 'patch conflict') {
        await writeFile(join(root, data.patches[0].path), 'bad patch');
        data.patches[0].sha256 = createHash('sha256')
          .update('bad patch')
          .digest('hex');
      }

      if (mutation === 'forbidden private import')
        await writeFile(
          join(root, data.outputs[0].path),
          "import x from 'vs/private';",
        );
      if (mutation === 'modified generated output')
        await writeFile(join(root, data.outputs[0].path), 'changed');
      await writeFile(path, JSON.stringify(data));
      await expect(verify(path)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
