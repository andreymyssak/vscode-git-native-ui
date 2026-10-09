import { defineConfig, mergeConfig } from 'vitest/config';

import webviewConfig from './vite.config.mts';

export default defineConfig((env) =>
  mergeConfig(webviewConfig(env), {
    define: { __DEV__: 'true' },
    test: {
      globals: false,
      maxWorkers: 4,
      projects: [
        {
          test: {
            name: 'unit',
            environment: 'node',
            include: ['test/unit/**/*.test.ts'],
            testTimeout: 30000,
            hookTimeout: 30000,
          },
        },
        {
          test: {
            name: 'integration',
            environment: 'node',
            include: ['test/integration/**/*.test.ts'],
            testTimeout: 30000,
            hookTimeout: 30000,
          },
        },
        {
          test: {
            name: 'component',
            include: ['test/component/**/*.test.{ts,tsx}'],
            environment: 'jsdom',
            setupFiles: ['test/component/setup.ts'],
          },
        },
      ],
    },
  }),
);
