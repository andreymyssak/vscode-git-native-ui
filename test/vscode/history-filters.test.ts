import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import * as vscode from 'vscode';

import type { GitAdapter } from '../../src/extension/git/adapter';
import { createGitAdapter } from '../../src/extension/git/adapter';
import { getGitApi } from '../../src/extension/git/api';
import type { HistoryFilters } from '../../src/shared/model';
import type { Fixture } from '../fixtures/repository';
import { createFixture } from '../fixtures/repository';

const execute = promisify(execFile);
const defaults: HistoryFilters = {
  regex: false,
  matchCase: false,
  author: { kind: 'all' },
  date: 'all',
};

describe('history filter native API', () => {
  let fixture: Fixture;
  let adapter: GitAdapter;
  let id: string;
  const bob = { name: 'Bob [native]', email: 'bob+native@example.test' };
  const alice = { name: 'Alice', email: 'alice@example.test' };
  const fixtureTime = Date.now();
  const subjects = async (filters: HistoryFilters, text = '') =>
    (
      await adapter.history(id, {
        scope: { kind: 'head' },
        text,
        cursor: null,
        filters,
      })
    ).commits.map((commit) => commit.message.trim());

  before(async () => {
    fixture = await createFixture({
      prefix: 'git-native-ui native filters ü ',
    });
    let parent = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
    const tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();

    for (const [message, identity, hours] of [
      ['Feature one', alice, 2],
      ['Feature two', bob, 3],
      ['Five days old', bob, 120],
      ['Literal [x].* MixedCase', alice, 4],
      ['Literal [x].* mixedcase', bob, 5],
    ] as const) {
      const date = `${Math.floor((fixtureTime - hours * 60 * 60 * 1000) / 1000)} +0000`;
      const authorHours = message === 'Feature two' ? 120 : hours;
      const authorDate = `${Math.floor((fixtureTime - authorHours * 60 * 60 * 1000) / 1000)} +0000`;

      parent = (
        await execute(
          'git',
          ['commit-tree', tree, '-p', parent, '-m', message],
          {
            cwd: fixture.root,
            env: {
              ...process.env,
              GIT_CONFIG_GLOBAL: join(fixture.root, 'isolated-gitconfig'),
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_AUTHOR_NAME: identity.name,
              GIT_AUTHOR_EMAIL: identity.email,
              GIT_COMMITTER_NAME: 'Native committer',
              GIT_COMMITTER_EMAIL: 'committer@example.test',
              GIT_AUTHOR_DATE: authorDate,
              GIT_COMMITTER_DATE: date,
            },
          },
        )
      ).stdout.trim();
    }

    await fixture.runGit(['update-ref', 'refs/heads/main', parent]);
    await fixture.runGit(['config', 'user.name', bob.name]);
    await fixture.runGit(['config', 'user.email', bob.email]);
    await (await getGitApi()).api.openRepository(vscode.Uri.file(fixture.root));
    adapter = await createGitAdapter();
    id = vscode.Uri.file(fixture.root).toString();
  });
  after(async () => {
    adapter?.dispose();
    await fixture?.dispose();
  });

  it('Me resolves configured Git identity and date filters use committer time', async () => {
    assert.deepEqual(
      await subjects({ ...defaults, author: { kind: 'me' }, date: '24h' }),
      ['Literal [x].* mixedcase', 'Feature two'],
    );
    assert.ok(
      (
        await subjects({ ...defaults, author: { kind: 'me' }, date: '7d' })
      ).includes('Five days old'),
    );
  });

  it('missing Git identity gives a useful Me error', async () => {
    await fixture.runGit(['config', '--unset', 'user.email']);
    await fixture.runGit(['config', '--unset', 'user.name']);
    try {
      await assert.rejects(
        () => subjects({ ...defaults, author: { kind: 'me' } }),
        /Configure.*Git identity/,
      );
    } finally {
      await fixture.runGit(['config', 'user.name', bob.name]);
      await fixture.runGit(['config', 'user.email', bob.email]);
    }
  });

  it('an inclusive calendar day filters the installed API history without writing', async () => {
    const date = new Date(fixtureTime - 120 * 60 * 60 * 1000);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const before = await fixture.runGit(['status', '--porcelain=v1']);

    assert.deepEqual(
      await subjects({
        ...defaults,
        date: { kind: 'range', from: day, to: day },
      }),
      ['Five days old'],
    );
    assert.equal(await fixture.runGit(['status', '--porcelain=v1']), before);
  });

  it('regex and case-aware queries hydrate exact native commit records', async () => {
    assert.deepEqual(
      await subjects({ ...defaults, regex: true }, '^Feature (one|two)$'),
      ['Feature two', 'Feature one'],
    );
    assert.deepEqual(
      await subjects({ ...defaults, matchCase: true }, '[x].* MixedCase'),
      ['Literal [x].* MixedCase'],
    );
  });

  it('author choices cover reachable repository history and queries remain read-only', async () => {
    const before = await fixture.runGit(['status', '--porcelain=v1']);
    const authors = await adapter.authors(id);

    assert.ok(
      authors.some(
        (identity) =>
          identity.name === bob.name && identity.email === bob.email,
      ),
    );
    assert.ok(
      authors.some(
        (identity) =>
          identity.name === alice.name && identity.email === alice.email,
      ),
    );
    assert.deepEqual(
      await subjects(
        { ...defaults, author: { kind: 'selected', identities: [alice] } },
        'Feature',
      ),
      ['Feature one'],
    );
    assert.equal(await fixture.runGit(['status', '--porcelain=v1']), before);
  });
});
