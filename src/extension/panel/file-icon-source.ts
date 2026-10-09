import picomatch from 'picomatch';

import type { FileIconTheme, IconLanguages } from '../../shared/file-icons';
import { isRecord } from '../../shared/validation';
import { compileFileIconTheme, iconResourcePath } from './file-icon-theme';

interface IconExtension {
  root: string;
  contributions: unknown;
}

interface Options {
  selectedId: string | null;
  extensions: readonly IconExtension[];
  prefix: string;
  variant: 'dark' | 'light' | 'highContrast';
  fileAssociations?: Record<string, string>;
  read(this: void, root: string, path: string): Promise<string | null>;
  resource(this: void, root: string, path: string): Promise<string | null>;
}

export interface InstalledIconTheme {
  theme: FileIconTheme;
  css: string;
  root: string | null;
}

const object = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

export function installedIconThemeRoots(
  extensions: readonly IconExtension[],
): string[] {
  const roots = new Set<string>();

  for (const extension of extensions) {
    const contributions = object(extension.contributions);
    const themes = Array.isArray(contributions.iconThemes)
      ? contributions.iconThemes.slice(0, 1000)
      : [];

    if (
      themes.some((value) => {
        const theme = object(value);
        const path = iconResourcePath('package.json', theme.path);

        return (
          typeof theme.id === 'string' &&
          theme.id.length > 0 &&
          theme.id.length <= 256 &&
          path !== null &&
          /\.jsonc?$/i.test(path)
        );
      })
    )
      roots.add(extension.root);
  }

  return [...roots];
}

function installedLanguages(options: Options): IconLanguages {
  const fileNames: Record<string, string> = {};

  Object.setPrototypeOf(fileNames, null);
  const extensions: Record<string, string> = {};

  Object.setPrototypeOf(extensions, null);
  const patterns: (NonNullable<IconLanguages['patterns']>[number] & {
    specificity: number;
  })[] = [];
  const addPattern = (
    pattern: unknown,
    language: string,
    configured: boolean,
  ) => {
    if (
      typeof pattern !== 'string' ||
      !pattern.length ||
      pattern.length > 256 ||
      patterns.length >= 2048
    )
      return;
    try {
      const regex = picomatch.makeRe(pattern, {
        nocase: true,
        dot: true,
        nonegate: true,
        noext: true,
        strictBrackets: true,
        maxLength: 256,
        windows: false,
      });

      if (regex.source.length > 4096) return;
      patterns.push({
        source: regex.source,
        language,
        matchPath: pattern.includes('/'),
        configured,
        specificity: pattern.length,
      });
    } catch {
      // Unsupported patterns leave the language's name/extension matches usable.
    }
  };

  for (const extension of options.extensions) {
    const contributions = object(extension.contributions);
    const languages = Array.isArray(contributions.languages)
      ? contributions.languages.slice(0, 1000)
      : [];

    for (const value of languages) {
      const language = object(value);

      if (typeof language.id !== 'string') continue;
      for (const name of Array.isArray(language.filenames)
        ? language.filenames
        : [])
        if (typeof name === 'string' && name.length <= 256)
          fileNames[name.toLowerCase()] = language.id;
      for (const suffix of Array.isArray(language.extensions)
        ? language.extensions
        : [])
        if (
          typeof suffix === 'string' &&
          suffix.startsWith('.') &&
          suffix.length <= 256
        )
          extensions[suffix.slice(1).toLowerCase()] = language.id;
      for (const pattern of Array.isArray(language.filenamePatterns)
        ? language.filenamePatterns
        : [])
        addPattern(pattern, language.id, false);
    }
  }

  for (const [pattern, language] of Object.entries(
    options.fileAssociations ?? {},
  ).slice(0, 1000)) {
    if (typeof language !== 'string') continue;
    addPattern(pattern, language, true);
  }

  return {
    fileNames,
    extensions,
    patterns: patterns
      .sort((left, right) => right.specificity - left.specificity)
      .map((pattern) => ({
        source: pattern.source,
        language: pattern.language,
        matchPath: pattern.matchPath,
        configured: pattern.configured,
      })),
  };
}

export async function readInstalledIconTheme(
  options: Options,
): Promise<InstalledIconTheme | null> {
  if (options.selectedId === null)
    return {
      theme: {
        definitions: {},
        associations: {
          fileNames: {},
          fileExtensions: {},
          languageIds: {},
          folderNames: {},
          folderNamesExpanded: {},
        },
        languages: { fileNames: {}, extensions: {} },
      },
      css: '',
      root: null,
    };
  for (const extension of options.extensions) {
    const contributions = object(extension.contributions);
    const themes = Array.isArray(contributions.iconThemes)
      ? contributions.iconThemes.slice(0, 1000)
      : [];

    for (const value of themes) {
      const contribution = object(value);

      if (contribution.id !== options.selectedId) continue;
      const themePath = iconResourcePath('package.json', contribution.path);

      if (!themePath || !/\.jsonc?$/i.test(themePath)) return null;
      try {
        const source = await options.read(extension.root, themePath);

        if (source === null) return null;
        const result = await compileFileIconTheme(source, {
          themePath,
          prefix: options.prefix,
          variant: options.variant,
          languages: installedLanguages(options),
          resource: (path) => options.resource(extension.root, path),
        });

        return result ? { ...result, root: extension.root } : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}
