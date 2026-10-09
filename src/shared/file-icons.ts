export interface FileIcon {
  className?: string;
  uri?: string;
}

export interface FileIconAssociations {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  languageIds: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
}

export interface IconLanguages {
  fileNames: Record<string, string>;
  extensions: Record<string, string>;
  patterns?: {
    source: string;
    language: string;
    matchPath: boolean;
    configured: boolean;
  }[];
}

const languagePatterns = new WeakMap<
  IconLanguages,
  { regex: RegExp; language: string; matchPath: boolean; configured: boolean }[]
>();

function patternLanguage(
  languages: IconLanguages,
  path: string,
  name: string,
  configured: boolean,
): string | undefined {
  if (path.length > 4096) return undefined;
  let patterns = languagePatterns.get(languages);

  if (!patterns) {
    patterns = (languages.patterns ?? []).map(({ source, ...pattern }) => ({
      ...pattern,
      regex: new RegExp(source, 'i'),
    }));
    languagePatterns.set(languages, patterns);
  }

  return patterns.find(
    (pattern) =>
      pattern.configured === configured &&
      pattern.regex.test(pattern.matchPath ? path : name),
  )?.language;
}

export interface FileIconTheme {
  definitions: Record<string, FileIcon>;
  associations: FileIconAssociations;
  languages: IconLanguages;
}

export interface FileIconThemeMessage {
  kind: 'file-icon-theme';
  theme: FileIconTheme | null;
  stylesheet: string | null;
}

export function resolveFileIcon(
  theme: FileIconTheme,
  path: string,
  kind: 'file' | 'folder',
  expanded = false,
): FileIcon | undefined {
  const parts = path.toLowerCase().split('/');
  const name = parts.at(-1) ?? '';
  const parent = parts.at(-2) ?? '';
  const associations = theme.associations;
  const read = (map: Record<string, string>, key: string) =>
    Object.hasOwn(map, key) ? map[key] : undefined;
  const named = (map: Record<string, string>, value: string) =>
    read(map, parent + '/' + value) ?? read(map, value);
  let id: string | undefined;

  if (kind === 'folder')
    id =
      (expanded ? named(associations.folderNamesExpanded, name) : undefined) ??
      named(associations.folderNames, name) ??
      (expanded ? associations.folderExpanded : undefined) ??
      associations.folder;
  else {
    const extensions = name
      .split('.')
      .slice(1)
      .map((_, index, all) => all.slice(index).join('.'));
    const extension = (map: Record<string, string>, qualified: boolean) =>
      extensions
        .map((suffix) => read(map, (qualified ? parent + '/' : '') + suffix))
        .find((value) => value !== undefined);
    const language =
      patternLanguage(theme.languages, path, name, true) ??
      read(theme.languages.fileNames, name) ??
      patternLanguage(theme.languages, path, name, false) ??
      extension(theme.languages.extensions, false);

    id =
      named(associations.fileNames, name) ??
      extension(associations.fileExtensions, true) ??
      extension(associations.fileExtensions, false) ??
      (language ? read(associations.languageIds, language) : undefined) ??
      associations.file;
  }

  return id
    ? Object.hasOwn(theme.definitions, id)
      ? theme.definitions[id]
      : {}
    : undefined;
}
