import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, expect, test } from 'vitest';

const cases = JSON.parse(
  readFileSync('test/fixtures/fsd/import-cases.json', 'utf8'),
) as {
  name: string;
  from: string;
  to: string;
  rule: string | null;
}[];

test.each(cases)('$name', async (item) => {
  const config = resolve('.dependency-cruiser.cjs');
  const cli = resolve(
    'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs',
  );
  const root = await mkdtemp(join(tmpdir(), 'git-ui-native-fsd-case-'));

  try {
    const files: Record<string, string> = {
      'src/webview/tsconfig.json': await readFile(
        'src/webview/tsconfig.json',
        'utf8',
      ),
      'tsconfig.webview.json': JSON.stringify({
        compilerOptions: {
          jsx: 'react-jsx',
          moduleResolution: 'Bundler',
          module: 'ESNext',
          paths: {
            '@webview/*': ['./src/webview/*'],
            '@contracts/*': ['./src/shared/*'],
          },
        },
      }),
      'src/webview/pages/log/index.ts': "export {value} from './ui/Inside';",
      'src/webview/pages/log/ui/Inside.tsx': 'export const value = 1;',
      'src/webview/pages/log/ui/index.ts': "export {value} from './Inside';",
      'src/webview/pages/worktrees/index.ts':
        "export {value} from './ui/Inside';",
      'src/webview/pages/worktrees/ui/Inside.tsx': 'export const value = 2;',
      'src/webview/app/model/state.ts': 'export const value = 3;',
      'src/extension/secret.ts': 'export const value = 4;',
      'src/vendor/graph.ts': 'export const value = 5;',
    };

    files[`src/webview/${item.from}`] =
      `import * as value from '${item.to}'; export {value};`;
    files['steiger.config.mjs'] =
      `import {defineConfig} from '${pathToFileURL(resolve('node_modules/steiger/dist/app.mjs')).href}'; import fsd from '${pathToFileURL(resolve('node_modules/@feature-sliced/steiger-plugin/dist/index.js')).href}'; export default defineConfig([...fsd.configs.recommended]);`;
    for (const [path, source] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }

    const result = spawnSync(
      process.execPath,
      [
        cli,
        'src',
        '--config',
        config,
        '--ts-config',
        'tsconfig.webview.json',
        '--output-type',
        'json',
      ],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.error).toBeUndefined();
    const validation = spawnSync(
      process.execPath,
      [
        cli,
        'src',
        '--config',
        config,
        '--ts-config',
        'tsconfig.webview.json',
        '--output-type',
        'err',
      ],
      { cwd: root, encoding: 'utf8' },
    );

    expect(validation.error).toBeUndefined();
    const report = JSON.parse(result.stdout) as {
      summary: {
        violations: {
          rule: {
            name: string;
          };
        }[];
      };
    };
    const rules = report.summary.violations.map((v) => v.rule.name);

    assert.ok(
      !rules.includes('not-to-unresolvable'),
      `${item.name}: unresolved fixture`,
    );
    if (item.rule) {
      expect(
        validation.status,
        `${item.name}: must reject ${validation.stdout}`,
      ).not.toBe(0);
      assert.ok(rules.includes(item.rule), `${item.name}: ${rules.join(', ')}`);
    } else
      expect(validation.status, `${item.name}: ${validation.stdout}`).toBe(0);
    const fsdRule =
      item.rule === 'page-public-api-only'
        ? 'fsd/no-public-api-sidestep'
        : [
              'pages-do-not-import-other-pages',
              'frontend-pages-and-shared-do-not-import-app',
            ].includes(item.rule ?? '')
          ? 'fsd/forbidden-imports'
          : null;

    if (fsdRule || !item.rule) {
      const fsd = spawnSync(
        process.execPath,
        [
          resolve('node_modules/steiger/dist/cli.mjs'),
          'src/webview',
          '--reporter',
          'json',
        ],
        { cwd: root, encoding: 'utf8' },
      );

      expect(fsd.error).toBeUndefined();
      if (fsdRule) {
        expect(
          fsd.status,
          `${item.name}: Steiger must reject aliases: ${fsd.stdout}`,
        ).not.toBe(0);
        assert.ok(fsd.stdout.includes(fsdRule), `${item.name}: ${fsd.stdout}`);
      } else expect(fsd.status, `${item.name}: ${fsd.stdout}`).toBe(0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
