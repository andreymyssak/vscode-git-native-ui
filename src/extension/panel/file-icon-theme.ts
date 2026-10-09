import { posix } from 'node:path';

import type { ParseError } from 'jsonc-parser/lib/esm/main.js';
import { parse } from 'jsonc-parser/lib/esm/main.js';

import type {
  FileIcon,
  FileIconAssociations,
  FileIconTheme,
  IconLanguages,
} from '../../shared/file-icons';
import { isRecord } from '../../shared/validation';

export interface CompileIconOptions {
  themePath: string;
  variant: 'dark' | 'light' | 'highContrast';
  prefix: string;
  resource(this: void, path: string): Promise<string | null>;
  languages: IconLanguages;
}

const object = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};
const size = (value: unknown, normalizePixels = false) => {
  if (typeof value !== 'string') return undefined;
  const pixels = /^\d{1,3}(?:\.\d{1,2})?px$/.test(value);
  const relative = pixels
    ? Math.round((Number.parseInt(value, 10) / 13) * 100) + '%'
    : value;

  return /^\d{1,3}(?:\.\d{1,2})?%$/.test(relative) &&
    Number.parseFloat(relative) >= 50 &&
    Number.parseFloat(relative) <= 300
    ? pixels && !normalizePixels
      ? value
      : relative
    : undefined;
};

const quote = (value: string) =>
  '"' +
  value.replace(
    /["\\<>]/g,
    (character) => '\\' + character.codePointAt(0)!.toString(16) + ' ',
  ) +
  '"';

export function iconResourcePath(base: string, value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    /[\\:%?#]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    value.startsWith('/')
  )
    return null;
  const path = posix.normalize(posix.join(posix.dirname(base), value));

  return path === '..' || path.startsWith('../') || path.startsWith('/')
    ? null
    : path;
}

function mappings(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};

  Object.setPrototypeOf(result, null);

  for (const [key, id] of Object.entries(object(value)).slice(0, 50_000)) {
    if (key.length <= 256 && typeof id === 'string' && id.length <= 256)
      result[key.toLowerCase()] = id;
  }

  return result;
}

function associations(
  base: Record<string, unknown>,
  variant: Record<string, unknown>,
): FileIconAssociations {
  const read = (name: string) =>
    typeof variant[name] === 'string'
      ? variant[name]
      : typeof base[name] === 'string'
        ? base[name]
        : undefined;
  const file = read('file');
  const folder = read('folder');
  const folderExpanded = read('folderExpanded');
  const map = (name: string) => ({
    ...mappings(base[name]),
    ...mappings(variant[name]),
  });

  return {
    ...(file !== undefined ? { file } : {}),
    ...(folder !== undefined ? { folder } : {}),
    ...(folderExpanded !== undefined ? { folderExpanded } : {}),
    fileNames: map('fileNames'),
    fileExtensions: map('fileExtensions'),
    folderNames: map('folderNames'),
    folderNamesExpanded: map('folderNamesExpanded'),
    languageIds: map('languageIds'),
  };
}

export async function compileFileIconTheme(
  text: string,
  options: CompileIconOptions,
): Promise<{ theme: FileIconTheme; css: string } | null> {
  if (
    text.length > 4_194_304 ||
    !/^git-file-theme-[a-z0-9-]+$/.test(options.prefix)
  )
    return null;
  const errors: ParseError[] = [];
  let document: Record<string, unknown>;

  try {
    const parsed: unknown = parse(text, errors, { allowTrailingComma: true });

    document = object(parsed);
  } catch {
    return null;
  }

  if (errors.length) return null;
  const definitions: Record<string, FileIcon> = {};

  Object.setPrototypeOf(definitions, null);
  const fonts = new Map<string, { family: string; size: string | undefined }>();
  const css: string[] = [];
  const resources = new Map<string, Promise<string | null>>();
  const resource = (value: unknown, extensions: RegExp) => {
    const path = iconResourcePath(options.themePath, value);

    if (!path || !extensions.test(path)) return Promise.resolve(null);
    let pending = resources.get(path);

    if (!pending) {
      pending = options.resource(path);
      resources.set(path, pending);
    }

    return pending;
  };

  const fontList = Array.isArray(document.fonts)
    ? document.fonts.slice(0, 32)
    : [];

  for (const [index, value] of fontList.entries()) {
    const font = object(value);

    if (typeof font.id !== 'string') continue;
    const sources = Array.isArray(font.src) ? font.src.slice(0, 8) : [];
    const urls: string[] = [];

    for (const source of sources) {
      const src = object(source);
      const uri = await resource(src.path, /\.(?:woff2?|ttf|otf)$/i);

      if (uri) urls.push(`url(${quote(uri)})`);
    }

    if (!urls.length) continue;
    const family = `${options.prefix}-font-${index}`;
    const weight =
      typeof font.weight === 'string' &&
      /^(?:normal|bold|[1-9]00)$/.test(font.weight)
        ? font.weight
        : 'normal';
    const style =
      font.style === 'italic' || font.style === 'oblique'
        ? font.style
        : 'normal';

    fonts.set(font.id, { family, size: size(font.size, true) });
    css.push(
      `@font-face{font-family:${quote(family)};src:${urls.join(',')};font-weight:${weight};font-style:${style};font-display:block}`,
    );
  }

  const firstFontId = object(fontList[0]).id;
  const defaultFont =
    typeof firstFontId === 'string' ? fonts.get(firstFontId) : undefined;
  const defaultDefinition = object(
    typeof document.file === 'string'
      ? object(document.iconDefinitions)[document.file]
      : undefined,
  );
  const inheritedFont = Object.fromEntries(
    Object.entries(defaultDefinition).filter(([key]) =>
      ['fontCharacter', 'fontColor', 'fontSize', 'fontId'].includes(key),
    ),
  );

  for (const [index, [id, value]] of Object.entries(
    object(document.iconDefinitions),
  )
    .slice(0, 20_000)
    .entries()) {
    const definition = { ...inheritedFont, ...object(value) };

    if (typeof definition.iconPath === 'string') {
      const uri = await resource(
        definition.iconPath,
        /\.(?:svg|png|jpe?g|gif|webp|ico|avif)$/i,
      );

      if (uri) definitions[id] = { uri };
      continue;
    }

    const font =
      typeof definition.fontId === 'string'
        ? fonts.get(definition.fontId)
        : defaultFont;
    const character = definition.fontCharacter;
    const code =
      typeof character === 'string' && /^\\[\da-f]{1,6}$/i.test(character)
        ? Number.parseInt(character.slice(1), 16)
        : typeof character === 'string' && [...character].length === 1
          ? character.codePointAt(0)
          : undefined;

    if (
      !font ||
      code === undefined ||
      code === 0 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      continue;
    const className = `${options.prefix}-${index}`;
    const color =
      typeof definition.fontColor === 'string' &&
      /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(definition.fontColor)
        ? definition.fontColor
        : undefined;
    const fontSize =
      size(definition.fontSize) ?? font.size ?? defaultFont?.size ?? '150%';

    definitions[id] = { className };
    css.push(
      `.${className}::before{content:"\\${code.toString(16)}";font-family:${quote(font.family)};font-size:${fontSize};font-style:normal;font-weight:normal;${color ? `color:${color};` : ''}}`,
    );
  }

  if (!Object.keys(definitions).length) return null;

  return {
    theme: {
      definitions,
      associations: associations(document, object(document[options.variant])),
      languages: options.languages,
    },
    css: css.join('\n'),
  };
}
