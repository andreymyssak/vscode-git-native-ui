import type { Page } from '@playwright/test';

export async function updateReferences(
  page: Page,
  local = ['main', 'topic', 'feature/nested'],
  sha = '1'.padStart(40, '0'),
  branch: string | null = 'main',
  repositoryId = 'one',
  generation = 1,
): Promise<void> {
  await page.evaluate(
    ({ local, sha, branch, repositoryId, generation }) => {
      const repository = {
        id: repositoryId,
        label: 'Example repository',
        rootUri: `file:///example/${repositoryId}`,
        headSha: sha,
        branch,
      };

      if (generation > 1)
        window.__deliver({
          requestId: 'refs-refresh',
          repositoryId,
          generation,
          body: {
            kind: 'loading',
            repository,
            scope: { kind: 'head' },
            text: '',
          },
        });
      window.__deliver({
        requestId: 'refs-refresh',
        repositoryId,
        generation,
        body: {
          kind: 'history',
          repository,
          scope: { kind: 'head' },
          text: '',
          append: false,
          page: {
            commits: [],
            refs: [
              ...local.map((name) => ({
                id: 'refs/heads/' + name,
                name,
                kind: 'local' as const,
                sha,
                remote: null,
              })),
              {
                id: 'refs/remotes/origin/main',
                name: 'origin/main',
                kind: 'remote',
                sha,
                remote: 'origin',
              },
              ...['@wk/api_v2.1.0', '@wk/api_v2.1.1'].map((name) => ({
                id: 'refs/tags/' + name,
                name,
                kind: 'tag' as const,
                sha,
                remote: null,
              })),
            ],
            nextCursor: null,
            scopeId: 'fixture',
          },
        },
      });
    },
    { local, sha, branch, repositoryId, generation },
  );
}
