import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

/** Match VS Code's home-relative file labels without exposing host details in fixtures. */
export function formatPathLabel({
  path,
  home = homedir(),
  windows = process.platform === 'win32',
}: {
  path: string;
  home?: string;
  windows?: boolean;
}): string {
  const paths = windows ? win32 : posix;
  const relative = paths.relative(home, path);

  if (!relative) return '~';
  if (
    relative !== '..' &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  )
    return `~${paths.sep}${relative}`;

  return path;
}
