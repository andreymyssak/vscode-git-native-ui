import { assert, expect, test } from 'vitest';

import { readInstalledIconTheme } from '../../src/extension/panel/file-icon-source';
import { resolveFileIcon } from '../../src/shared/file-icons';

test('selected contribution reads assets only from its owning extension and uses installed language names', async () => {
  const reads: string[] = [];
  const resources: string[] = [];
  const result = await readInstalledIconTheme({
    selectedId: 'chosen',
    prefix: 'git-file-theme-test',
    variant: 'dark',
    extensions: [
      {
        root: 'owner',
        contributions: {
          iconThemes: [{ id: 'chosen', path: './icons/theme.json' }],
        },
      },
      {
        root: 'other',
        contributions: {
          languages: [
            { id: 'special', extensions: ['.spec'], filenames: ['Buildfile'] },
          ],
        },
      },
    ],
    read: async (root, path) => {
      reads.push(root + '/' + path);

      return JSON.stringify({
        iconDefinitions: {
          language: { iconPath: './special.svg' },
          generic: { iconPath: './file.svg' },
        },
        languageIds: { special: 'language' },
        file: 'generic',
      });
    },
    resource: async (root, path) => {
      resources.push(root + '/' + path);

      return 'https://webview.test/' + path;
    },
  });

  assert.ok(result);
  expect(result.root).toBe('owner');
  expect(reads).toStrictEqual(['owner/icons/theme.json']);
  expect(resources.sort()).toStrictEqual([
    'owner/icons/file.svg',
    'owner/icons/special.svg',
  ]);
  expect(resolveFileIcon(result.theme, 'folder/Buildfile', 'file')?.uri).toBe(
    'https://webview.test/icons/special.svg',
  );
  expect(resolveFileIcon(result.theme, 'folder/a.spec', 'file')?.uri).toBe(
    'https://webview.test/icons/special.svg',
  );
});
test('escaped theme contributions cannot read files and an unavailable theme returns fallback', async () => {
  const reads: string[] = [];
  const result = await readInstalledIconTheme({
    selectedId: 'chosen',
    prefix: 'git-file-theme-test',
    variant: 'dark',
    extensions: [
      {
        root: 'owner',
        contributions: {
          iconThemes: [{ id: 'chosen', path: '../outside.json' }],
        },
      },
    ],
    read: async (_, path) => {
      reads.push(path);

      return '{}';
    },
    resource: async () => null,
  });

  expect(result).toBe(null);
  expect(reads).toStrictEqual([]);
});
test('choosing no icon theme suppresses icons without reading any extension resources', async () => {
  const result = await readInstalledIconTheme({
    selectedId: null,
    prefix: 'git-file-theme-test',
    variant: 'dark',
    extensions: [],
    read: async () => {
      throw new Error('must not read');
    },
    resource: async () => {
      throw new Error('must not read');
    },
  });

  assert.ok(result);
  expect(result.theme.definitions).toStrictEqual({});
  expect(resolveFileIcon(result.theme, 'file.ts', 'file')).toBe(undefined);
  expect(result.root).toBe(null);
  expect(result.css).toBe('');
});
test('contributed filename patterns recognize Dockerfile variants and dotenv files', async () => {
  const result = await readInstalledIconTheme({
    selectedId: 'chosen',
    prefix: 'git-file-theme-test',
    variant: 'dark',
    extensions: [
      {
        root: 'owner',
        contributions: {
          iconThemes: [{ id: 'chosen', path: './theme.json' }],
          languages: [
            {
              id: 'dockerfile',
              filenamePatterns: ['Dockerfile.*', 'Containerfile.*'],
            },
            { id: 'dotenv', filenamePatterns: ['.env.*'] },
          ],
        },
      },
    ],
    read: async () =>
      JSON.stringify({
        iconDefinitions: {
          docker: { iconPath: './docker.svg' },
          env: { iconPath: './env.svg' },
          file: { iconPath: './file.svg' },
        },
        languageIds: { dockerfile: 'docker', dotenv: 'env' },
        file: 'file',
      }),
    resource: async (_, path) => 'https://webview.test/' + path,
  });

  assert.ok(result);
  for (const path of ['Dockerfile.dev', 'src/Containerfile.prod'])
    expect(resolveFileIcon(result.theme, path, 'file')?.uri).toBe(
      'https://webview.test/docker.svg',
    );
  expect(
    resolveFileIcon(result.theme, 'src/.env.production', 'file')?.uri,
  ).toBe('https://webview.test/env.svg');
  expect(resolveFileIcon(result.theme, 'myDockerfile.dev', 'file')?.uri).toBe(
    'https://webview.test/file.svg',
  );
});
test('configured file associations override declared filename languages and honor directory globs', async () => {
  const result = await readInstalledIconTheme({
    selectedId: 'chosen',
    prefix: 'git-file-theme-test',
    variant: 'dark',
    fileAssociations: {
      'Dockerfile.*': 'python',
      '**/templates/*.{yaml,yml}': 'python',
    },
    extensions: [
      {
        root: 'owner',
        contributions: {
          iconThemes: [{ id: 'chosen', path: './theme.json' }],
          languages: [
            {
              id: 'dockerfile',
              filenames: ['Dockerfile.dev'],
              filenamePatterns: ['Dockerfile.*'],
            },
          ],
        },
      },
    ],
    read: async () =>
      JSON.stringify({
        iconDefinitions: {
          docker: { iconPath: './docker.svg' },
          python: { iconPath: './python.svg' },
          file: { iconPath: './file.svg' },
        },
        languageIds: { dockerfile: 'docker', python: 'python' },
        file: 'file',
      }),
    resource: async (_, path) => 'https://webview.test/' + path,
  });

  assert.ok(result);
  expect(resolveFileIcon(result.theme, 'Dockerfile.dev', 'file')?.uri).toBe(
    'https://webview.test/python.svg',
  );
  expect(
    resolveFileIcon(result.theme, 'app/templates/file.yaml', 'file')?.uri,
  ).toBe('https://webview.test/python.svg');
  expect(resolveFileIcon(result.theme, 'app/file.yaml', 'file')?.uri).toBe(
    'https://webview.test/file.svg',
  );
});
