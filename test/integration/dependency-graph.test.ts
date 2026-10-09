import { spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { assert, expect, test } from 'vitest';

test('generated dependency graph connects aliases to the actual page and contract modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'git-native-ui-graph-'));

  try {
    await symlink(
      resolve('node_modules'),
      join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    for (const config of [
      'package.json',
      'tsconfig.base.json',
      'tsconfig.webview.json',
      '.dependency-cruiser.cjs',
    ])
      await copyFile(config, join(root, config));
    const files = {
      'src/webview/app/layout/App.tsx':
        "import {log} from '@webview/pages/log'; import {worktrees} from '@webview/pages/worktrees'; import type {Commit} from '@contracts/model'; export const app: Commit = {sha: log + worktrees};",
      'src/webview/pages/log/index.ts': "export const log = 'log';",
      'src/webview/pages/worktrees/index.ts':
        "export const worktrees = 'worktrees';",
      'src/shared/model.ts': 'export interface Commit {sha: string}',
    };

    for (const [path, source] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }

    const npm = process.env.npm_execpath;

    assert.ok(npm, 'Run graph tests through an npm test command.');
    const result = spawnSync(process.execPath, [npm, 'run', 'graph'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const graph = await readFile(
      join(root, '.artifacts/dependencies.mmd'),
      'utf8',
    );
    const folders: string[] = [];
    const nodes = new Map<string, string>();

    for (const line of graph.split('\n')) {
      const folder = /^subgraph \w+\["([^"]+)"\]$/.exec(line);
      const node = /^(\w+)\["([^"]+)"\]$/.exec(line);

      if (folder) folders.push(folder[1]!);
      else if (line === 'end') folders.pop();
      else if (node) nodes.set([...folders, node[2]!].join('/'), node[1]!);
    }

    const app = nodes.get('src/webview/app/layout/App.tsx');

    assert.ok(app, 'App must appear in the graph');
    for (const target of [
      'src/webview/pages/log/index.ts',
      'src/webview/pages/worktrees/index.ts',
      'src/shared/model.ts',
    ]) {
      const id = nodes.get(target);

      assert.ok(id, `${target} must appear in the graph`);
      assert.ok(
        graph.includes(`${app}-->${id}\n`),
        `App must connect to ${target}`,
      );
    }

    expect(graph, 'aliases must not become unresolved graph nodes').not.toMatch(
      /@webview|@contracts/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
