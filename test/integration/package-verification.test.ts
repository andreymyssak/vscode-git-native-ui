import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

import * as verifier from '../../scripts/package/verify.ts';

const inputs = (...paths: string[]) => ({
  inputs: Object.fromEntries(paths.map((path) => [path, {}])),
});
const sources = (...paths: string[]) => ({ sources: paths });
const production = [
  'node_modules/react/cjs/react.production.js',
  'node_modules/react/cjs/react-jsx-runtime.production.js',
  'node_modules/react/cjs/react-compiler-runtime.production.js',
  'node_modules/react-dom/cjs/react-dom-client.production.js',
  'node_modules/scheduler/cjs/scheduler.production.js',
];

test('package verification rejects a host framework, development React or test tooling', async () => {
  verifier.verifyBuildInputs(
    inputs('src/extension/activate.ts'),
    sources(...production),
  );
  expect(() =>
    verifier.verifyBuildInputs(inputs(production[0]!), sources(...production)),
  ).toThrow(/host.*react/i);
  expect(() =>
    verifier.verifyBuildInputs(
      inputs(),
      sources(...production, 'node_modules/react/cjs/react.development.js'),
    ),
  ).toThrow(/development/i);
  expect(() =>
    verifier.verifyBuildInputs(
      inputs(),
      sources(...production, 'node_modules/vite/dist/client/client.mjs'),
    ),
  ).toThrow(/tooling/i);
  expect(() =>
    verifier.verifyBuildInputs(inputs(), sources(...production.slice(0, 2))),
  ).toThrow(/react-dom.*production/i);
});
test('package verification excludes UI libraries from the host and compiler tooling from runtime', async () => {
  for (const dependency of [
    '@tanstack/react-virtual',
    '@floating-ui/react',
    'zustand',
    'clsx',
  ])
    expect(() =>
      verifier.verifyBuildInputs(
        inputs('node_modules/' + dependency + '/index.js'),
        sources(...production),
      ),
    ).toThrow(/host/i);
  for (const dependency of [
    '@babel/core',
    '@rolldown/plugin-babel',
    'babel-plugin-react-compiler',
    'eslint-plugin-react-hooks',
    'eslint-plugin-simple-import-sort',
    '@stylistic/eslint-plugin',
  ])
    expect(() =>
      verifier.verifyBuildInputs(
        inputs(),
        sources(...production, 'node_modules/' + dependency + '/index.js'),
      ),
    ).toThrow(/tooling/i);
});
test('package verification accepts relative source-map paths on either platform', () => {
  expect(() =>
    verifier.verifyBuildInputs(
      inputs('src/extension/activate.ts'),
      sources(...production.map((path) => '../' + path)),
    ),
  ).not.toThrow();
  expect(() =>
    verifier.verifyBuildInputs(
      inputs('src/extension/activate.ts'),
      sources(
        ...production.map((path) => ('../' + path).replaceAll('/', '\\')),
      ),
    ),
  ).not.toThrow();
});
test.each([
  null,
  {},
  { sources: null },
  { sources: 'file.ts' },
  { sources: [1] },
])(
  'package verification rejects malformed source-map evidence: %j',
  (sourceMap) => {
    expect(() => verifier.verifyBuildInputs(inputs(), sourceMap)).toThrow(
      /webview.*source/i,
    );
  },
);
test('package verification requires the bundled UI libraries complete license text', async () => {
  const paths = [
    'react/LICENSE',
    'react-dom/LICENSE',
    'scheduler/LICENSE',
    '@floating-ui/react/LICENSE',
    '@tanstack/react-virtual/LICENSE',
    'zustand/LICENSE',
    'clsx/license',
    'jsonc-parser/LICENSE.md',
    'picomatch/LICENSE',
  ];
  const sections = await Promise.all(
    paths.map(
      async (path) =>
        path + '\n\n' + (await readFile('node_modules/' + path, 'utf8')),
    ),
  );

  verifier.verifyUiLicenses(sections.join('\n\n'));
  for (const missing of paths.slice(3))
    expect(() =>
      verifier.verifyUiLicenses(
        sections
          .filter((section) => !section.startsWith(missing + '\n'))
          .join('\n\n'),
      ),
    ).toThrow(/license text/i);
});
test('package verification requires the license text beyond dependency headings', async () => {
  expect(() =>
    verifier.verifyUiLicenses(
      'react/LICENSE\n\nreact-dom/LICENSE\n\nscheduler/LICENSE',
    ),
  ).toThrow(/react.*license text/i);
});
test('the release manifest and lockfile describe the same installable MIT candidate', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
    name: string;
    version: string;
    license: string;
    private: boolean;
    icon: string;
  };
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as {
    name: string;
    version: string;
    packages: Record<
      string,
      {
        name: string;
        version: string;
        license: string;
      }
    >;
  };

  verifier.verifyReleaseManifest(manifest);
  expect(manifest.license).toBe('MIT');
  expect(manifest.private).toBe(true);
  expect(lock.name).toBe(manifest.name);
  expect(lock.packages['']?.name).toBe(manifest.name);
  expect(lock.version).toBe(manifest.version);
  expect(lock.packages['']?.version).toBe(manifest.version);
  expect(lock.packages['']?.license).toBe(manifest.license);
  const icon = await readFile(manifest.icon);

  expect(icon.subarray(0, 8)).toStrictEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(icon.readUInt32BE(16)).toBe(256);
  expect(icon.readUInt32BE(20)).toBe(256);
});
test('release verification refuses missing support, source, license or icon metadata', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as Record<
    string,
    unknown
  >;

  for (const field of [
    'repository',
    'homepage',
    'bugs',
    'license',
    'icon',
    'keywords',
  ]) {
    const candidate = { ...manifest };

    delete candidate[field];
    expect(() => verifier.verifyReleaseManifest(candidate)).toThrow(
      new RegExp(field, 'i'),
    );
  }

  expect(() =>
    verifier.verifyReleaseManifest({ ...manifest, version: '0.0.0' }),
  ).toThrow(/version/i);
  expect(() =>
    verifier.verifyReleaseManifest({ ...manifest, version: '0.0.1' }),
  ).not.toThrow();
  expect(() =>
    verifier.verifyReleaseManifest({ ...manifest, version: '01.1.0' }),
  ).toThrow(/version/i);
  expect(() =>
    verifier.verifyReleaseManifest({
      ...manifest,
      repository: {
        type: 'git',
        url: 'https://github.com/example/git-native-ui.git',
      },
    }),
  ).toThrow(/repository/i);
});
const helperMetafile = () => ({
  inputs: {
    'src/extension/git/squash-helper.ts': {
      imports: [{ path: 'node:fs/promises', external: true }],
    },
  },
  outputs: {
    'dist/squash-helper.cjs': {
      entryPoint: 'src/extension/git/squash-helper.ts',
      imports: [{ path: 'node:fs/promises', external: true }],
    },
  },
});

test('the private helper is a separate Node-only bundle with its own entry point', async () => {
  verifier.verifySquashHelperInputs(helperMetafile());
  expect(() =>
    verifier.verifySquashHelperInputs({ inputs: {}, outputs: {} }),
  ).toThrow(/helper.*entry|helper.*bundle/i);
  for (const module of [
    'vscode',
    'vitest',
    'react',
    './missing-helper-runtime.cjs',
  ]) {
    const helper = helperMetafile();

    helper.outputs['dist/squash-helper.cjs'].imports.push({
      path: module,
      external: true,
    });
    expect(() => verifier.verifySquashHelperInputs(helper)).toThrow(
      /helper.*external|helper.*runtime/i,
    );
  }
});
test('the private helper refuses bundled VS Code, UI libraries and development tooling', async () => {
  for (const dependency of [
    'vscode',
    'react',
    'vite',
    '@testing-library/react',
    '@stylistic/eslint-plugin',
  ]) {
    const helper = helperMetafile();
    const contaminated = {
      ...helper,
      inputs: {
        ...helper.inputs,
        [`node_modules/${dependency}/index.js`]: { imports: [] },
      },
    };

    expect(() => verifier.verifySquashHelperInputs(contaminated)).toThrow(
      /helper.*dependency|helper.*tooling|helper.*vscode/i,
    );
  }
});
