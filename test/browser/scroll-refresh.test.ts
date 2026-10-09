import { expect, test } from '@playwright/test';

import type { PanelBody } from '../../src/shared/messages';
import type { RestorableView } from '../../src/shared/model';
import { loadHistoryPages } from './history-paging';

test('background restoration keeps the previous history and latest scroll until partial pages arrive', async ({
  page,
}) => {
  await page.goto('/');
  await loadHistoryPages(page, 3);
  const history = page.locator('#history');

  await history.evaluate((node) => {
    node.scrollTop = 8503;
    node.dispatchEvent(new Event('scroll'));
  });
  const expectedAnchor = { sha: '183'.padStart(40, '0'), offset: 11 };

  expect(
    await page.evaluate(
      () =>
        window.__requests
          .filter((request) => request.body.kind === 'anchor')
          .at(-1)?.body,
    ),
  ).toEqual({ kind: 'anchor', anchor: expectedAnchor });
  await page.evaluate(() => {
    const repository = {
      id: 'one',
      label: 'Example repository',
      rootUri: 'file:///example',
      branch: 'main',
      headSha: '1'.padStart(40, '0'),
    };
    const commits = Array.from({ length: 600 }, (_, index) => ({
      sha: (index + 1).toString(16).padStart(40, '0'),
      parents: [(index + 2).toString(16).padStart(40, '0')],
      message: 'Commit ' + (index + 1),
      authorName: 'Fixture author',
      authorEmail: 'fixture@example.test',
      authorDate: null,
      commitDate: null,
    }));
    const send = (body: PanelBody) =>
      window.__deliver({
        requestId: 'refresh',
        repositoryId: 'one',
        generation: 2,
        body,
      });

    Reflect.set(window, 'restoreHistoryPage', (index: number) =>
      send({
        kind: 'history',
        repository,
        scope: { kind: 'head' },
        text: '',
        append: index > 0,
        restoring: true,
        page: {
          commits: commits.slice(index * 200, (index + 1) * 200),
          refs: [],
          nextCursor: String((index + 1) * 200),
          scopeId: 'fixture',
        },
      }),
    );
    send({
      kind: 'loading',
      repository,
      scope: { kind: 'head' },
      text: '',
      preserve: true,
    });
  });
  await expect(page.locator('[data-history-content]')).toHaveCSS(
    'height',
    '13200px',
  );
  await expect(history).toHaveAttribute('inert', '');
  expect(await history.evaluate((node) => node.scrollTop)).toBe(8503);
  await history.evaluate((node) => node.dispatchEvent(new Event('scroll')));
  expect(
    await page.evaluate(
      () => (window.__savedWrites.at(-1) as RestorableView).anchor,
    ),
  ).toEqual(expectedAnchor);
  for (let index = 0; index < 3; index++) {
    await page.evaluate(
      (pageIndex) =>
        (Reflect.get(window, 'restoreHistoryPage') as (index: number) => void)(
          pageIndex,
        ),
      index,
    );
    await expect(page.locator('[data-history-content]')).toHaveCSS(
      'height',
      `${(index + 1) * 4400}px`,
    );
    await history.evaluate((node) => node.dispatchEvent(new Event('scroll')));
    expect(
      await page.evaluate(
        () => (window.__savedWrites.at(-1) as RestorableView).anchor,
      ),
    ).toEqual(expectedAnchor);
  }

  await page.evaluate(() =>
    window.__deliver({
      requestId: 'refresh',
      repositoryId: 'one',
      generation: 2,
      body: { kind: 'history-settled' },
    }),
  );
  await expect
    .poll(() => history.evaluate((node) => node.scrollTop))
    .toBe(8503);
  await expect(history).not.toHaveAttribute('inert', '');
  await history.evaluate((node) => {
    node.scrollTop = 8504;
    node.dispatchEvent(new Event('scroll'));
  });
  expect(
    await page.evaluate(
      () =>
        window.__requests
          .filter((request) => request.body.kind === 'anchor')
          .at(-1)?.body,
    ),
  ).toEqual({ kind: 'anchor', anchor: { ...expectedAnchor, offset: 12 } });
});
