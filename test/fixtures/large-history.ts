import { spawn } from 'node:child_process';
import { join } from 'node:path';

import type { Fixture } from './repository';
import { createFixture } from './repository';

export async function createLargeHistory(count = 30000): Promise<Fixture> {
  const fixture = await createFixture({ prefix: 'git-ui-native 30k ' });

  try {
    const base = (await fixture.runGit(['rev-parse', 'HEAD'])).trim();
    const commands: string[] = [];
    let mark = 0;
    let previous = base;
    let penultimate = base;
    const commit = (
      ref: string,
      message: string,
      parent: string,
      merge: string | null,
    ) => {
      const next = `:${++mark}`;

      commands.push(
        `commit ${ref}\nmark ${next}\ncommitter Fixture <fixture@example.test> ${1700000000 + mark} +0000\ndata ${Buffer.byteLength(message)}\n${message}\nfrom ${parent}\n${merge ? `merge ${merge}\n` : ''}\n`,
      );

      return next;
    };

    for (let i = 1; i <= count; i++) {
      const side =
        i % 1000 === 0
          ? commit('refs/heads/perf-side', `Side ${i}`, penultimate, null)
          : null;
      const next = commit('refs/heads/main', `Large ${i}`, previous, side);

      penultimate = previous;
      previous = next;
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['fast-import', '--quiet'], {
        cwd: fixture.root,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: join(fixture.root, 'isolated-gitconfig'),
          GIT_CONFIG_NOSYSTEM: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let errors = '';

      child.stderr.on('data', (data) => {
        errors += String(data);
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(errors)),
      );
      child.stdin.end(commands.join(''));
    });

    return fixture;
  } catch (error) {
    await fixture.dispose();
    throw error;
  }
}
