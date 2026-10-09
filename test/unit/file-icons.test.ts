import { assert, expect, test } from 'vitest';

import { compileFileIconTheme } from '../../src/extension/panel/file-icon-theme';
import { resolveFileIcon } from '../../src/shared/file-icons';

const themeJson = JSON.stringify({
  fonts: [
    {
      id: 'seti',
      src: [{ path: './seti.woff', format: 'woff' }],
      size: '150%',
    },
  ],
  iconDefinitions: {
    file: { fontCharacter: '\\E001', fontColor: '#519aba' },
    ts: { fontCharacter: '\\E002' },
    named: { iconPath: './named.svg' },
    folder: { iconPath: './folder.svg' },
    open: { iconPath: './open.svg' },
    light: { fontCharacter: '\\E003', fontColor: '#498ba7' },
  },
  file: 'file',
  folder: 'folder',
  folderExpanded: 'open',
  fileNames: { 'readme.ts': 'named', 'special/readme.ts': 'light' },
  fileExtensions: { ts: 'ts', 'd.ts': 'named', 'special/ts': 'light' },
  languageIds: { typescript: 'ts' },
  folderNames: { src: 'named', 'app/src': 'light' },
  light: { fileExtensions: { ts: 'light' } },
});
const options = {
  themePath: 'icons/theme.json',
  variant: 'dark' as const,
  prefix: 'git-file-theme-test',
  resource: async (path: string) => `https://webview.test/${path}`,
  languages: { fileNames: { 'special-script': 'typescript' }, extensions: {} },
};

test('Explorer precedence uses parent names then compound extensions then language defaults', async () => {
  const result = await compileFileIconTheme(themeJson, options);

  assert.ok(result);
  const lookup = (path: string) => resolveFileIcon(result.theme, path, 'file');

  expect(lookup('src/README.ts')).toBe(result.theme.definitions.named);
  expect(lookup('special/readme.ts')).toBe(result.theme.definitions.light);
  expect(lookup('src/index.d.ts')).toBe(result.theme.definitions.named);
  expect(lookup('special/index.d.ts')).toBe(result.theme.definitions.light);
  expect(lookup('special-script')).toBe(result.theme.definitions.ts);
  expect(lookup('no-match')).toBe(result.theme.definitions.file);
});
test('expanded folders honor specific parent names and theme variants inherit the other associations', async () => {
  const result = await compileFileIconTheme(themeJson, {
    ...options,
    variant: 'light',
  });

  assert.ok(result);
  expect(resolveFileIcon(result.theme, 'src/file.ts', 'file')).toBe(
    result.theme.definitions.light,
  );
  expect(resolveFileIcon(result.theme, 'src/README.ts', 'file')).toBe(
    result.theme.definitions.named,
  );
  expect(resolveFileIcon(result.theme, 'app/src', 'folder', true)).toBe(
    result.theme.definitions.light,
  );
  expect(resolveFileIcon(result.theme, 'other', 'folder', true)).toBe(
    result.theme.definitions.open,
  );
  expect(resolveFileIcon(result.theme, 'other', 'folder', false)).toBe(
    result.theme.definitions.folder,
  );
});
test('Seti glyph CSS and image URLs use only resources inside the theme extension', async () => {
  const paths: string[] = [];
  const result = await compileFileIconTheme('// comment\n' + themeJson, {
    ...options,
    resource: async (path) => {
      paths.push(path);

      return `https://webview.test/${path}`;
    },
  });

  assert.ok(result);
  expect(result.css).toMatch(/content:"\\e001"/i);
  expect(result.css).toMatch(/font-size:150%/);
  expect(result.css).toMatch(/color:#519aba/);
  expect(result.theme.definitions.named?.uri).toBe(
    'https://webview.test/icons/named.svg',
  );
  expect(paths.sort()).toStrictEqual([
    'icons/folder.svg',
    'icons/named.svg',
    'icons/open.svg',
    'icons/seti.woff',
  ]);
});
test('malformed themes and external paths never grant resource access or inject CSS', async () => {
  const paths: string[] = [];
  const result = await compileFileIconTheme(
    JSON.stringify({
      fonts: [
        { id: 'evil', src: [{ path: '../../outside.woff', format: 'woff' }] },
      ],
      iconDefinitions: {
        escape: { iconPath: '../../outside.svg' },
        network: { iconPath: 'https://evil.test/tracker.svg' },
        encoded: { iconPath: '%2e%2e/outside.svg' },
        glyph: {
          fontCharacter: '\\E001"}body{display:none}',
          fontColor: 'red;}',
        },
      },
      file: 'escape',
    }),
    {
      ...options,
      resource: async (path) => {
        paths.push(path);

        return path;
      },
    },
  );

  expect(result).toBe(null);
  expect(paths).toStrictEqual([]);
  expect(await compileFileIconTheme('{ broken', options)).toBe(null);
  expect(await compileFileIconTheme(' '.repeat(4194305), options)).toBe(null);
});
test('a repository file called constructor still receives the generic icon', async () => {
  const result = await compileFileIconTheme(themeJson, {
    ...options,
    languages: { fileNames: {}, extensions: {} },
  });

  assert.ok(result);
  expect(resolveFileIcon(result.theme, 'constructor', 'file')).toBe(
    result.theme.definitions.file,
  );
});
test('invalid individual assets fall back without discarding other valid theme definitions', async () => {
  const paths: string[] = [];
  const result = await compileFileIconTheme(
    JSON.stringify({
      iconDefinitions: {
        valid: { iconPath: './file.svg' },
        outside: { iconPath: '../../outside.svg' },
      },
      file: 'valid',
      fileNames: { 'outside.txt': 'outside' },
    }),
    {
      ...options,
      resource: async (path) => {
        paths.push(path);

        return 'https://webview.test/' + path;
      },
    },
  );

  assert.ok(result);
  expect(resolveFileIcon(result.theme, 'file.txt', 'file')?.uri).toBe(
    'https://webview.test/icons/file.svg',
  );
  expect(paths).toStrictEqual(['icons/file.svg']);
  expect(result.theme.definitions.outside).toBe(undefined);
});
test('deep malformed JSON cannot throw out of the bounded theme parser', async () => {
  expect(
    await compileFileIconTheme('['.repeat(20000) + ']'.repeat(20000), options),
  ).toBe(null);
});
test('icon font defaults and pixel declarations use native label-relative scaling', async () => {
  for (const [size, expected] of [
    [undefined, '150%'],
    ['26px', '200%'],
  ]) {
    const result = await compileFileIconTheme(
      JSON.stringify({
        fonts: [
          {
            id: 'icons',
            size,
            src: [{ path: './icons.woff', format: 'woff' }],
          },
        ],
        iconDefinitions: { file: { fontCharacter: '\\E001' } },
        file: 'file',
      }),
      options,
    );

    assert.ok(result);
    expect(result.css).toMatch(new RegExp('font-size:' + expected));
  }
});
test('per-icon pixel sizes stay absolute instead of scaling with the label', async () => {
  const result = await compileFileIconTheme(
    JSON.stringify({
      fonts: [{ id: 'icons', src: [{ path: './icons.woff', format: 'woff' }] }],
      iconDefinitions: { file: { fontCharacter: '\\E001', fontSize: '26px' } },
      file: 'file',
    }),
    options,
  );

  assert.ok(result);
  expect(result.css).toMatch(/font-size:26px/);
});
