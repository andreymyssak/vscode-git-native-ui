import { GitCli } from '../../src/extension/git/cli';
import { SquashRecovery } from '../../src/extension/git/squash-recovery';
import { squashAccess } from './squash-repository';

const [root, storage] = process.argv.slice(2);

if (!root || !storage || process.argv.length !== 4)
  throw new Error('Expected the owned fixture root and recovery storage.');

void new SquashRecovery(storage, new GitCli(squashAccess(root)))
  .reconcile()
  .catch((error: unknown) => {
    process.stderr.write(String(error));
    process.exitCode = 1;
  });
