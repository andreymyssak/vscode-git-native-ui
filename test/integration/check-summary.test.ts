import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from 'vitest';

test.each([
  { status: 'success', exit: 0, label: 'Passed' },
  { status: 'failure', exit: 1, label: 'Failed' },
  { status: 'cancelled', exit: 1, label: 'Cancelled' },
  { status: 'skipped', exit: 1, label: 'Incomplete' },
])(
  'the summary command reports $status and exits with $exit',
  async ({ status, exit, label }) => {
    const root = await mkdtemp(join(tmpdir(), 'git-ui-native-check-summary-'));
    const path = join(root, 'summary.md');

    try {
      await writeFile(path, '');
      const result = spawnSync(
        process.execPath,
        [resolve('scripts/test/check-summary.ts')],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            GITHUB_STEP_SUMMARY: path,
            GITHUB_SERVER_URL: 'https://github.com',
            GITHUB_REPOSITORY: 'example/project',
            GITHUB_RUN_ID: '1',
            CHECK_TITLE: 'Extension checks',
            CHECK_RESULTS: JSON.stringify([{ name: 'Native tests', status }]),
          },
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(exit);
      expect(await readFile(path, 'utf8')).toContain(`Overall: ${label}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
