import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The hand-made SVG/PNG library lives in /assets (icons, weather images). It is not processed
// by Vite, so it is copied verbatim into dist/assets after the bundle is written.
function copyAssets() {
  return {
    name: 'lime-copy-assets',
    apply: 'build',
    closeBundle() {
      const root = process.cwd();
      if (existsSync(resolve(root, 'assets'))) {
        cpSync(resolve(root, 'assets'), resolve(root, 'dist/assets'), { recursive: true });
      }
    }
  };
}

// Vite rewrites <link rel="manifest" href="manifest.webmanifest"> into a hashed asset under
// /assets/. That breaks the PWA: the manifest's icon paths are relative to the manifest, so
// /assets/manifest-abc.webmanifest would look for /assets/pwa-192.png. Keep the URL literal.
function keepManifestUrl() {
  return {
    name: 'lime-keep-manifest-url',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(
        /<link\s+rel="manifest"[^>]*href="[^"]*"[^>]*>/,
        '<link rel="manifest" href="manifest.webmanifest">'
      );
    }
  };
}

export default defineConfig({
  plugins: [vue(), copyAssets(), keepManifestUrl()],
  // Relative base: emitted asset URLs resolve against the document, so one build works both at
  // a domain root and under /repo-name/ (GitHub Pages).
  base: './',
  // public/ holds files that must keep their exact names and URLs: the manifest, the service
  // worker and the install icons. Vite copies them untouched. Putting them through the normal
  // asset pipeline would hash and relocate the manifest, breaking its relative icon paths.
  publicDir: 'public',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' }
});
