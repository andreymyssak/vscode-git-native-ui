import { fileURLToPath } from 'node:url';

import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import type { PluginOptions } from 'babel-plugin-react-compiler';
import { defineConfig } from 'vite';

const compilerOptions = {
  target: '19',
  panicThreshold: 'all',
} satisfies PluginOptions;

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset(compilerOptions)] }),
  ],
  css: { transformer: 'lightningcss' },
  resolve: {
    alias: {
      '@webview': fileURLToPath(new URL('./src/webview', import.meta.url)),
      '@contracts': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  define: {
    __DEV__: String(mode !== 'production'),
    'process.env.NODE_ENV': JSON.stringify(
      mode === 'production' ? 'production' : 'development',
    ),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: false,
    minify: mode === 'production',
    rolldownOptions: {
      input: 'src/webview/app/entrypoint/main.tsx',
      output: {
        format: 'iife',
        entryFileNames: 'webview.js',
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? 'webview.css'
            : '[name][extname]',
      },
    },
  },
}));
