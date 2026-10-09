import type { AuthorIdentity } from '../../shared/model';
import { hasErrorCode } from '../../shared/validation';
import type { GitCli } from './cli';

export async function readUserIdentity(
  cli: GitCli,
  id: string,
  signal?: AbortSignal,
): Promise<AuthorIdentity | null> {
  // API-1 getConfig reads only --local; Git resolves global/includes/worktree overrides.
  const config = async (key: string) => {
    try {
      return (await cli.run(id, ['config', '--get', key], signal)).trimEnd();
    } catch (error) {
      if (hasErrorCode(error, 1)) return '';
      throw error;
    }
  };

  const email = await config('user.email');

  if (email) return { name: '', email };
  const name = await config('user.name');

  return name ? { name, email: '' } : null;
}
