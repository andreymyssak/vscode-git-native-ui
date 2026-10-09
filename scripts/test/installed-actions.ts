import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { hasErrorCode, isRecord } from '../shared/validation.ts';

function readResult(value: unknown) {
  if (!isRecord(value)) throw new Error('Invalid installed action result');
  if (typeof value.error === 'string') {
    return {
      kind: 'failed',
      message: typeof value.stack === 'string' ? value.stack : value.error,
    } as const;
  }

  if (!Array.isArray(value.passed))
    throw new Error('Missing installed action results');
  const passed = value.passed.map((name: unknown) => {
    if (typeof name !== 'string')
      throw new Error('Invalid installed action case');

    return name;
  });

  return { kind: 'passed', passed } as const;
}

export async function runInstalledActions({
  executable,
  extensions,
  launchArgs,
  env,
}: {
  executable: string;
  extensions: string;
  launchArgs: readonly string[];
  env: NodeJS.ProcessEnv;
}) {
  // macOS limits the length of VS Code's IPC socket path inside this profile.
  const profile = mkdtempSync(join(tmpdir(), 'gnu-actions-'));
  const driver = mkdtempSync(resolve('.artifacts/installed-actions-driver-'));
  const resultPath = join(driver, 'result.json');

  mkdirSync(join(profile, 'User'));
  writeFileSync(
    join(profile, 'User/settings.json'),
    JSON.stringify({
      'window.dialogStyle': 'custom',
      'git.autofetch': false,
      'git.confirmSync': false,
    }),
  );
  writeFileSync(
    join(driver, 'package.json'),
    JSON.stringify({
      name: 'git-native-ui-installed-actions-driver',
      publisher: 'local-fixture',
      version: '0.0.0',
      engines: { vscode: '^1.140.0' },
      main: './extension.cjs',
      activationEvents: ['onStartupFinished'],
      extensionDependencies: ['git-native-ui.git-native-ui'],
    }),
  );
  writeFileSync(
    join(driver, 'extension.cjs'),
    `exports.activate = async () => {
      const fs = require('node:fs');
      let result;
      try {
        const passed = [
          ...await require(${JSON.stringify(resolve('dist/test/vscode/acceptance/branch-update.scenario.cjs'))}).run(),
          ...await require(${JSON.stringify(resolve('dist/test/vscode/acceptance/branch-actions.scenario.cjs'))}).run(),
        ];
        result = { passed };
      } catch (error) {
        result = { error: String(error), stack: error?.stack };
      }
      fs.writeFileSync(${JSON.stringify(resultPath + '.pending')}, JSON.stringify(result));
      fs.renameSync(${JSON.stringify(resultPath + '.pending')}, ${JSON.stringify(resultPath)});
    };`,
  );
  // The temporary test extension runs UI scenarios against the installed product
  // in a normal VS Code window, including its native notifications.
  const child = spawn(
    executable,
    [
      ...launchArgs,
      '--disable-updates',
      '--no-cached-data',
      `--extensionDevelopmentPath=${driver}`,
      '--extensions-dir',
      extensions,
      '--user-data-dir',
      profile,
    ],
    { env, stdio: 'inherit' },
  );
  let startupError: Error | undefined;

  child.once('error', (error) => {
    startupError = error;
  });
  const deadline = Date.now() + 120000;

  try {
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (child.exitCode !== null)
        throw new Error(
          `Installed action test window exited early: ${child.exitCode}`,
        );

      let result: ReturnType<typeof readResult> | undefined;

      try {
        result = readResult(JSON.parse(await readFile(resultPath, 'utf8')));
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      }

      if (result) {
        if (result.kind === 'failed') throw new Error(result.message);
        for (const name of result.passed) console.log(`Passed: ${name}`);
        if (result.passed.length !== 15)
          throw new Error(
            'Expected all fifteen installed branch action cases.',
          );
        console.log('15 installed branch action cases passed.');

        return;
      }

      await delay(250);
    }

    throw new Error('Installed branch action tests timed out.');
  } finally {
    child.kill();
  }
}
