import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Single source of truth for the on-screen version: package.json.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    {
      name: 'wwtp-app-version-html',
      transformIndexHtml: (html) => html.replace(/%APP_VERSION%/g, pkg.version),
    },
  ],
});
