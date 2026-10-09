import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import type { CommitRecord } from '../../src/shared/model';

const execute = promisify(execFile);

test('a real crossed, octopus and disconnected history renders across virtualized rows', async ({
  page,
}) => {
  test.setTimeout(60000);
  const created = await execute(process.execPath, [
    'scripts/dev/create-demo.ts',
  ]);
  const demo = JSON.parse(created.stdout) as {
    root: string;
    commits: number;
    mergeCommits: number;
  };

  try {
    const git = async (args: string[]) =>
      (await execute('git', args, { cwd: demo.root })).stdout;
    const output = await git([
      'log',
      '--all',
      '--topo-order',
      '--format=%H%x00%P%x00%B%x00%an%x00%ae%x00%aI%x00%cI%x1e',
    ]);
    const commits: CommitRecord[] = output
      .split('\x1e')
      .filter((row) => row.trim())
      .map((row) => {
        const [
          sha = '',
          parents = '',
          message = '',
          authorName = '',
          authorEmail = '',
          authorDate = '',
          commitDate = '',
        ] = row.trim().split('\0');

        return {
          sha,
          parents: parents ? parents.split(' ') : [],
          message: message.trim(),
          authorName,
          authorEmail,
          authorDate,
          commitDate,
        };
      });

    expect(commits).toHaveLength(153);
    expect(commits.filter((commit) => commit.parents.length > 1)).toHaveLength(
      25,
    );
    expect(commits.some((commit) => commit.parents.length === 3)).toBe(true);
    expect(commits.filter((commit) => !commit.parents.length)).toHaveLength(2);
    await page.goto('/');
    await page.evaluate(
      (commits) =>
        window.__deliver({
          requestId: 'tangled',
          repositoryId: 'one',
          generation: 1,
          body: {
            kind: 'history',
            repository: {
              id: 'one',
              label: 'Tangled local demo',
              rootUri: 'file:///demo',
              headSha: commits[0]!.sha,
              branch: 'main',
            },
            scope: { kind: 'all' },
            text: '',
            append: false,
            page: { commits, refs: [], scopeId: 'tangled', nextCursor: null },
          },
        }),
      commits,
    );
    const merge = commits.find((commit) => commit.parents.length === 3)!;
    const index = commits.indexOf(merge);

    await page.locator('#history').evaluate((node, offset) => {
      node.scrollTop = offset * 22;
    }, index);
    const row = page.locator(`[data-commit-row][data-sha="${merge.sha}"]`);

    await expect(row).toBeVisible();
    await expect(row.locator('[data-commit-graph] svg')).toBeVisible();
    expect(
      await row.locator('[data-commit-graph] svg path').count(),
    ).toBeGreaterThanOrEqual(3);
    await row.click();
    expect(
      (await page.evaluate(() => window.__requests)).some(
        (request) =>
          request.body.kind === 'select-commits' &&
          request.body.activeSha === merge.sha,
      ),
    ).toBe(true);
    await page.screenshot({ path: '.artifacts/tangled-graph-browser.png' });
    await page.locator('#history').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(
      page.locator(`[data-commit-row][data-sha="${commits.at(-1)!.sha}"]`),
    ).toBeVisible();
    await expect
      .poll(() => page.locator('[data-commit-row]').count())
      .toBeLessThan(60);
  } finally {
    await rm(dirname(demo.root), { recursive: true, force: true });
  }
});
