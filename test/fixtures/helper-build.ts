import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';

/** Bundle standalone Node entry points into an owned, disposable directory. */
export async function buildHelperFixture<T extends string>(
  entries: Record<T, string>,
  prefix = 'git-native-ui-helper-',
) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const paths = {} as Record<T, string>;
  const dispose = () => rm(directory, { recursive: true, force: true });

  try {
    for (const name of Object.keys(entries) as T[]) {
      const outfile = join(directory, `${name}.cjs`);

      await build({
        entryPoints: [resolve(entries[name])],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'es2022',
      });
      paths[name] = outfile;
    }

    return { directory, paths, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
