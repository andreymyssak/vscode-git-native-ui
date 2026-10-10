import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';

import type {
  GitApiAccess,
  GitCommit,
  GitLogOptions,
} from '../../src/extension/git/api';
import { GitCli } from '../../src/extension/git/cli';
import { createHistoryQueries } from '../../src/extension/git/history';
import type { HistoryFilters, HistoryInput } from '../../src/shared/model';
import type { Fixture } from '../fixtures/repository';
import { createFixture } from '../fixtures/repository';

const execute = promisify(execFile);
const hour = 60 * 60 * 1000;
const bob = { name: 'Bob [dev]', email: 'bob+dev@example.test' };
const alice = { name: 'Alice', email: 'alice@example.test' };
const defaults = {
  regex: false,
  matchCase: false,
  author: { kind: 'all' as const },
  date: 'all' as const,
};

describe('history filters against real Git', () => {
  let fixture: Fixture;
  let access: GitApiAccess;
  let cli: GitCli;
  let now = Date.UTC(2026, 9, 8, 12);
  let head: string;
  let initial: string;
  let tree: string;
  let commits: Map<string, string>;
  const originalGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
  const input = (filters: HistoryFilters, text = ''): HistoryInput => ({
    scope: { kind: 'head' },
    text,
    cursor: null,
    filters,
  });
  const query = () => createHistoryQueries(access, cli, () => now);
  const subjects = async (filters: HistoryFilters, text = '') =>
    (await query().page('fixture', input(filters, text))).commits.map(
      (commit) => commit.message.trim(),
    );

  async function commit(message: string, identity: typeof alice, age: number) {
    const sha = (
      await execute('git', ['commit-tree', tree, '-p', head, '-m', message], {
        cwd: fixture.root,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: join(fixture.root, 'isolated-gitconfig'),
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: identity.name,
          GIT_AUTHOR_EMAIL: identity.email,
          GIT_COMMITTER_NAME: 'Committer',
          GIT_COMMITTER_EMAIL: 'committer@example.test',
          GIT_AUTHOR_DATE: `${Math.floor((now - age) / 1000)} +0000`,
          GIT_COMMITTER_DATE: `${Math.floor((now - age) / 1000)} +0000`,
        },
      })
    ).stdout.trim();

    head = sha;
    commits.set(message, sha);
  }

  beforeAll(async () => {
    fixture = await createFixture({ prefix: 'git-ui-native filters ü ' });
    process.env.GIT_CONFIG_GLOBAL = join(fixture.root, 'isolated-gitconfig');
    head = initial = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
    tree = (await fixture.runGit(['rev-parse', 'HEAD^{tree}'])).trim();
    commits = new Map();
    await commit('Feature one', alice, 2 * hour);
    await commit('Feature two', bob, 3 * hour);
    await commit('Literal [x].* MixedCase', alice, 4 * hour);
    await commit('Literal [x].* mixedcase', bob, 5 * hour);
    await commit('Five days old', bob, 5 * 24 * hour);
    await commit('Old descendant', alice, 12 * 24 * hour);
    await commit(`Mention ${initial.slice(0, 7)}`, bob, 6 * hour);
    await fixture.runGit(['update-ref', 'refs/heads/main', head]);
    await fixture.runGit(['config', 'user.name', bob.name]);
    await fixture.runGit(['config', 'user.email', bob.email]);
    const getCommit = async (ref: string): Promise<GitCommit> => {
      const fields = (
        await fixture.runGit([
          'show',
          '--no-patch',
          '--format=%H%x00%P%x00%B%x00%an%x00%ae%x00%at%x00%ct',
          ref,
          '--',
        ])
      )
        .trimEnd()
        .split('\0');

      return {
        hash: fields[0]!,
        parents: fields[1]!.split(' ').filter(Boolean),
        message: fields[2]!,
        authorName: fields[3]!,
        authorEmail: fields[4]!,
        authorDate: new Date(Number(fields[5]) * 1000),
        commitDate: new Date(Number(fields[6]) * 1000),
      };
    };

    const repository = {
      rootUri: { fsPath: fixture.root },
      state: { HEAD: { name: 'main', commit: head } },
      getCommit,
      getConfig: async (key: string) => {
        try {
          return (
            await fixture.runGit(['config', '--local', '--get', key])
          ).trim();
        } catch (error) {
          if (
            (
              error as {
                code?: number;
              }
            ).code === 1
          )
            return '';
          throw error;
        }
      },
      getRefs: async () => [{ type: 0, name: 'main', commit: head }],
      log: async (options: GitLogOptions) => {
        const ids = (
          await fixture.runGit([
            'log',
            '--topo-order',
            '--format=%H',
            ...(options.grep
              ? [
                  '--extended-regexp',
                  '--regexp-ignore-case',
                  `--grep=${options.grep}`,
                ]
              : []),
            `--skip=${options.skip ?? 0}`,
            `--max-count=${options.maxEntries ?? 200}`,
            ...(options.refNames ?? []),
            '--',
          ])
        )
          .trim()
          .split('\n')
          .filter(Boolean);

        return Promise.all(ids.map(getCommit));
      },
    };

    access = {
      api: { git: { path: 'git' } },
      repository: () => repository,
    } as unknown as GitApiAccess;
    cli = new GitCli(access);
  });
  afterAll(async () => {
    if (originalGlobalConfig === undefined)
      delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalGlobalConfig;
    await fixture?.dispose();
  });
  it('keeps default literal case-insensitive punctuation matching', async () => {
    expect(await subjects(defaults, '[x].* mixedcase')).toStrictEqual([
      'Literal [x].* mixedcase',
      'Literal [x].* MixedCase',
    ]);
  });
  it('uses regex alternation and anchors only when requested', async () => {
    expect(
      await subjects({ ...defaults, regex: true }, '^Feature (one|two)$'),
    ).toStrictEqual(['Feature two', 'Feature one']);
  });
  it('matches message case independently of literal punctuation', async () => {
    expect(
      await subjects({ ...defaults, matchCase: true }, '[x].* MixedCase'),
    ).toStrictEqual(['Literal [x].* MixedCase']);
  });
  it('selects exact author identities with regex metacharacters safely', async () => {
    expect(
      await subjects({
        ...defaults,
        author: { kind: 'selected', identities: [bob] },
      }),
    ).toStrictEqual([
      `Mention ${initial.slice(0, 7)}`,
      'Five days old',
      'Literal [x].* mixedcase',
      'Feature two',
    ]);
  });
  it('Me uses repository Git email rather than operating-system identity', async () => {
    expect(
      await subjects({ ...defaults, author: { kind: 'me' } }, 'Feature'),
    ).toStrictEqual(['Feature two']);
  });
  it('Me reports missing Git identity instead of silently returning everyone', async () => {
    await fixture.runGit(['config', '--unset', 'user.email']);
    await fixture.runGit(['config', '--unset', 'user.name']);
    try {
      await expect(
        subjects({ ...defaults, author: { kind: 'me' } }),
      ).rejects.toThrow(/Git.*identity|user\.email|configure/i);
    } finally {
      await fixture.runGit(['config', 'user.email', bob.email]);
      await fixture.runGit(['config', 'user.name', bob.name]);
    }
  });
  it('date limits use commit time and retain newer ancestors after older descendants', async () => {
    const day = await subjects({ ...defaults, date: '24h' });

    assert.ok(day.includes('Feature one'));
    assert.ok(day.includes('Feature two'));
    assert.ok(!day.includes('Five days old'));
    assert.ok(!day.includes('Old descendant'));
    assert.ok(
      (await subjects({ ...defaults, date: '7d' })).includes('Five days old'),
    );
  });
  it('reused filtered readers keep author queries separate and refresh time and Me identity', async () => {
    const reader = query();
    const selected = input(
      { ...defaults, author: { kind: 'selected', identities: [alice] } },
      'Feature',
    );
    const first = await reader.page('fixture', selected);

    await reader.page(
      'fixture',
      input({ ...defaults, matchCase: true }, 'Feature two'),
    );
    expect((await reader.page('fixture', selected)).commits).toStrictEqual(
      first.commits,
    );
    expect(first.commits.map((commit) => commit.message.trim())).toStrictEqual([
      'Feature one',
    ]);
    const date = input({ ...defaults, date: '24h' }, 'Feature');

    expect((await reader.page('fixture', date)).commits.length).toBe(2);
    const previousTime = now;

    now += 8 * 24 * hour;
    try {
      expect((await reader.page('fixture', date)).commits.length).toBe(0);
    } finally {
      now = previousTime;
    }

    const me = input({ ...defaults, author: { kind: 'me' } }, 'Feature');

    expect((await reader.page('fixture', me)).commits[0]?.message.trim()).toBe(
      'Feature two',
    );
    await fixture.runGit(['config', 'user.email', alice.email]);
    try {
      expect(
        (await reader.page('fixture', me)).commits[0]?.message.trim(),
      ).toBe('Feature one');
    } finally {
      await fixture.runGit(['config', 'user.email', bob.email]);
    }
  });
  it('author and date restrictions apply to both hash and message union', async () => {
    expect(
      await subjects(
        {
          ...defaults,
          author: { kind: 'selected', identities: [bob] },
          date: '24h',
        },
        initial.slice(0, 7),
      ),
    ).toStrictEqual([`Mention ${initial.slice(0, 7)}`]);
  });
  it('invalid regex rejects without changing HEAD or tracked content', async () => {
    const before = await fixture.runGit(['status', '--porcelain=v1']);

    await expect(subjects({ ...defaults, regex: true }, '[')).rejects.toThrow(
      /regex|regular expression|Invalid/i,
    );
    expect((await fixture.runGit(['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect(await fixture.runGit(['status', '--porcelain=v1'])).toBe(before);
  });
  it('highlight annotations use fresh Git identity even on cached history', async () => {
    const reader = query();
    const first = await reader.page('fixture', input(defaults));

    expect(first.annotations?.user).toStrictEqual({
      name: '',
      email: bob.email,
    });
    expect(first.annotations?.currentBranch).toStrictEqual(
      first.commits.map((commit) => commit.sha),
    );
    await fixture.runGit(['config', 'user.email', alice.email]);
    try {
      const cached = await reader.page('fixture', input(defaults));

      expect(cached.annotations?.user).toStrictEqual({
        name: '',
        email: alice.email,
      });
      expect(cached.commits).toStrictEqual(first.commits);
    } finally {
      await fixture.runGit(['config', 'user.email', bob.email]);
    }
  });
  it('global and included identity configuration works while repository overrides take precedence', async () => {
    const global = join(fixture.root, 'isolated-gitconfig');
    const included = join(fixture.root, 'included-identity');

    await writeFile(
      included,
      `[user]\nname = ${alice.name}\nemail = ${alice.email}\n`,
    );
    await fixture.runGit([
      'config',
      '--file',
      global,
      'include.path',
      included,
    ]);
    const reader = query();

    try {
      expect(
        (await reader.page('fixture', input(defaults))).annotations?.user,
      ).toStrictEqual({ name: '', email: bob.email });
      await fixture.runGit(['config', '--unset', 'user.email']);
      await fixture.runGit(['config', '--unset', 'user.name']);
      expect(
        (await reader.page('fixture', input(defaults))).annotations?.user,
      ).toStrictEqual({ name: '', email: alice.email });
      expect(
        (
          await reader.page(
            'fixture',
            input({ ...defaults, author: { kind: 'me' } }, 'Feature'),
          )
        ).commits.map((commit) => commit.message.trim()),
      ).toStrictEqual(['Feature one']);
    } finally {
      await writeFile(global, '');
      await fixture.runGit(['config', 'user.email', bob.email]);
      await fixture.runGit(['config', 'user.name', bob.name]);
    }
  });
  it('current-branch highlighting includes shared ancestors and excludes divergent commits', async () => {
    const other = (
      await fixture.runGit([
        'commit-tree',
        tree,
        '-p',
        initial,
        '-m',
        'Other branch',
      ])
    ).trim();
    const repository = access.repository('fixture');
    const original = repository.getRefs;

    repository.getRefs = async () => [
      { type: 0, name: 'main', commit: head },
      { type: 0, name: 'other', commit: other },
    ];
    try {
      const reader = query();
      const page = await reader.page('fixture', {
        ...input(defaults),
        scope: { kind: 'ref', refId: 'refs/heads/other' },
      });

      expect(page.commits.map((commit) => commit.sha)).toStrictEqual([
        other,
        initial,
      ]);
      expect(page.annotations?.currentBranch).toStrictEqual([initial]);
      const all = await reader.page('fixture', {
        ...input(defaults),
        scope: { kind: 'all' },
      });

      assert.ok(all.commits.some((commit) => commit.sha === other));
      assert.ok(!all.annotations?.currentBranch.includes(other));
      assert.ok(all.annotations?.currentBranch.includes(initial));
    } finally {
      repository.getRefs = original;
    }
  });
  it('an inclusive calendar day includes only commits inside that local day', async () => {
    const date = new Date(now - 5 * 24 * hour);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    expect(
      await subjects({
        ...defaults,
        date: { kind: 'range', from: day, to: day },
      }),
    ).toStrictEqual(['Five days old']);
  });
  it('filtered pages pin the cutoff/tips and reject cursors under changed options', async () => {
    const oldHead = head;

    for (let index = 0; index < 205; index++)
      await commit(`Page ${index}`, bob, hour);
    await fixture.runGit(['update-ref', 'refs/heads/main', head]);
    const reader = query();
    const firstDefault = await reader.page('fixture', {
      scope: { kind: 'head' },
      text: '',
      cursor: null,
    });

    expect(firstDefault.commits.length).toBe(200);
    assert.ok(firstDefault.nextCursor);
    const secondDefault = await reader.page('fixture', {
      ...input(defaults),
      cursor: firstDefault.nextCursor,
    });

    expect(secondDefault.commits.length).toBe(13);
    const request = input({
      ...defaults,
      author: { kind: 'selected', identities: [bob] },
      date: '24h',
    });
    const first = await reader.page('fixture', request);

    expect(first.commits.length).toBe(200);
    assert.ok(first.nextCursor);
    const previousTime = now;

    now += 8 * 24 * hour;
    try {
      const second = await reader.page('fixture', {
        ...request,
        cursor: first.nextCursor,
      });

      expect(second.commits.length).toBe(8);
      assert.ok(
        second.commits.some(
          (commit) => commit.message.trim() === 'Feature two',
        ),
      );
      await expect(
        reader.page('fixture', {
          ...input({ ...defaults, author: { kind: 'me' } }),
          cursor: first.nextCursor,
        }),
      ).rejects.toThrow(/History changed/);
    } finally {
      now = previousTime;
      head = oldHead;
      await fixture.runGit(['update-ref', 'refs/heads/main', head]);
    }
  }, 60000);
});
