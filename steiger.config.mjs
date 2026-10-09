import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

export default defineConfig([
  ...fsd.configs.recommended,
  { files: ['src/webview/**/*.d.ts'], rules: { 'fsd/public-api': 'off' } },
]);
