import { posix, win32 } from 'node:path';

export function pathKey(
  path: string,
  platform: string = process.platform,
): string {
  return platform === 'win32'
    ? win32.normalize(path).toLowerCase()
    : posix.normalize(path);
}

export function sameRoot(
  left: string,
  right: string,
  platform: string = process.platform,
): boolean {
  return pathKey(left, platform) === pathKey(right, platform);
}

/** Includes equality; path segments prevent sibling prefix collisions. */
export function containsRoot(
  parent: string,
  child: string,
  platform: string = process.platform,
): boolean {
  const paths = platform === 'win32' ? win32 : posix;
  const part = paths.relative(
    pathKey(parent, platform),
    pathKey(child, platform),
  );

  return (
    part === '' ||
    (!paths.isAbsolute(part) &&
      part !== '..' &&
      !part.startsWith('..' + paths.sep))
  );
}
