import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { assert, expect, onTestFinished, test } from 'vitest';

const execute = promisify(execFile);
const name = 'git-native-ui-policy-fixture';

async function fixture(versions: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'git-native-ui npm-policy '));
  const server = createServer((request, response) => {
    if (request.url !== `/${name}`) {
      response.writeHead(404).end();

      return;
    }

    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        name,
        'dist-tags': { latest: '1.0.1' },
        time: versions,
        versions: Object.fromEntries(
          Object.keys(versions).map((version) => [
            version,
            {
              name,
              version,
              dist: { tarball: `${registry}/${name}-${version}.tgz` },
            },
          ]),
        ),
      }),
    );
  });

  onTestFinished(async () => {
    if (server.listening)
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    await rm(root, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();

  assert.ok(address && typeof address === 'object');
  const registry = `http://127.0.0.1:${address.port}`;
  const npm = process.env.npm_execpath;

  assert.ok(npm, 'Run installer tests through an npm test command.');
  await writeFile(join(root, '.npmrc'), await readFile(resolve('.npmrc')));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'policy-consumer',
      version: '1.0.0',
      private: true,
    }),
  );
  await writeFile(join(root, 'user.npmrc'), '');
  await writeFile(join(root, 'global.npmrc'), '');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)),
  );

  return {
    manifest: async () =>
      JSON.parse(await readFile(join(root, 'package.json'), 'utf8')),
    install: () =>
      execute(
        process.execPath,
        [
          npm,
          'install',
          name,
          '--package-lock-only',
          `--registry=${registry}`,
          '--no-audit',
          '--no-fund',
        ],
        {
          cwd: root,
          timeout: 15000,
          env: {
            ...env,
            npm_config_cache: join(root, 'cache'),
            npm_config_userconfig: join(root, 'user.npmrc'),
            npm_config_globalconfig: join(root, 'global.npmrc'),
          },
        },
      ),
  };
}

test('the two-day cooldown skips a recent release and saves the eligible version exactly', async () => {
  const f = await fixture({
    '1.0.0': new Date(Date.now() - 2.5 * 86400000).toISOString(),
    '1.0.1': new Date(Date.now() - 1.5 * 86400000).toISOString(),
  });

  await f.install();
  expect((await f.manifest()).dependencies).toStrictEqual({ [name]: '1.0.0' });
});

test('dependency installation refuses a package with only a fresh release', async () => {
  const f = await fixture({
    '1.0.1': new Date(Date.now() - 1.5 * 86400000).toISOString(),
  });

  await expect(f.install()).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringMatching(/No matching version|No versions available/),
  });
  expect((await f.manifest()).dependencies).toBeUndefined();
});
