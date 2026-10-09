import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { defineConfig } from '@vscode/test-cli';

mkdirSync('.artifacts', { recursive: true });
const gitConfig = resolve('.artifacts/test-global.gitconfig');

writeFileSync(gitConfig, '');
const base = {
  env: {
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  },
  version: process.env.VSCODE_TEST_VERSION ?? '1.140.0',
  platform: 'desktop',
  ...(process.env.VSCODE_EXECUTABLE_PATH
    ? { useInstallation: { fromPath: process.env.VSCODE_EXECUTABLE_PATH } }
    : {}),
  launchArgs: [
    '--disable-extensions',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--disable-gpu',
  ],
  mocha: {
    ui: 'bdd',
    timeout: 30000,
    reporter: process.env.CI ? 'json-stream' : 'spec',
  },
};

const untrustedProfile = mkdtempSync(join(tmpdir(), 'gnu-trust-'));
const nativeProfile = mkdtempSync(join(tmpdir(), 'gnu-native-'));
const untrustedWorkspace = resolve('.artifacts/untrusted-workspace');
const nativeWorkspace = mkdtempSync(resolve('.artifacts/native-workspace-'));

mkdirSync(untrustedWorkspace, { recursive: true });
mkdirSync(join(nativeProfile, 'User'));
writeFileSync(
  join(nativeProfile, 'User/settings.json'),
  JSON.stringify({ 'window.menuStyle': 'custom' }),
);
mkdirSync(resolve(untrustedProfile, 'User'), { recursive: true });
writeFileSync(
  resolve(untrustedProfile, 'User/settings.json'),
  JSON.stringify({
    'security.workspace.trust.enabled': true,
    'security.workspace.trust.emptyWindow': false,
    'security.workspace.trust.startupPrompt': 'never',
  }),
);
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();

  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();

    if (!address || typeof address === 'string')
      return reject(new Error('No debug port'));
    server.close(() => resolvePort(address.port));
  });
});

export default defineConfig([
  {
    ...base,
    label: 'native',
    workspaceFolder: nativeWorkspace,
    files: 'dist/test/vscode/*.test.cjs',
    env: { ...base.env, VSCODE_TEST_DEBUG_PORT: String(port) },
    launchArgs: [
      ...base.launchArgs,
      '--user-data-dir',
      nativeProfile,
      `--remote-debugging-port=${port}`,
    ],
  },
  {
    ...base,
    label: 'installed',
    files: [
      'dist/test/vscode/package.test.cjs',
      'dist/test/vscode/commit-menu.test.cjs',
      'dist/test/vscode/history-editing.test.cjs',
      'dist/test/vscode/branch-restore.test.cjs',
      'dist/test/vscode/notifications.test.cjs',
      'dist/test/vscode/history-events.test.cjs',
      'dist/test/vscode/file-activation.test.cjs',
      'dist/test/vscode/file-latency.test.cjs',
      'dist/test/vscode/graph-interaction.test.cjs',
      'dist/test/vscode/branch-selection.test.cjs',
      'dist/test/vscode/parent-comparisons.test.cjs',
      'dist/test/vscode/header-controls.test.cjs',
      'dist/test/vscode/worktrees.test.cjs',
    ],
    env: { ...base.env, VSCODE_TEST_DEBUG_PORT: String(port) },
    launchArgs: [
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-gpu',
      `--remote-debugging-port=${port}`,
    ],
  },
  {
    ...base,
    label: 'restricted',
    workspaceFolder: untrustedWorkspace,
    files: 'dist/test/vscode/restricted/*.test.cjs',
    launchArgs: [
      '--disable-extensions',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-gpu',
      '--user-data-dir',
      untrustedProfile,
    ],
  },
]);
