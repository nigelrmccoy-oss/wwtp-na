import { defineConfig } from 'vite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

// Single source of truth for the on-screen version: package.json.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Optional SFX overrides actually present in public/sfx (procedural Web Audio is the default).
// Only these are fetched at runtime, so a missing override never produces a 404.
const sfxDir = new URL('./public/sfx/', import.meta.url);
const sfxFiles = existsSync(sfxDir)
  ? readdirSync(sfxDir).filter((f) => /\.(ogg|wav|mp3)$/i.test(f)).map((f) => `sfx/${f}`)
  : [];

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __SFX_FILES__: JSON.stringify(sfxFiles) },
  plugins: [
    {
      name: 'wwtp-app-version-html',
      transformIndexHtml: (html) => html.replace(/%APP_VERSION%/g, pkg.version),
    },
  ],
});
