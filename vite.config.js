import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function syncAssetDirectories() {
  const root = process.cwd();
  const srcAssets = resolve(root, 'assets');
  if (!existsSync(srcAssets)) return;
  cpSync(srcAssets, resolve(root, 'public/assets'), { recursive: true });
}

// The hand-made SVG/PNG library lives in /assets (icons, weather images). Ensure it is always
// present in public/assets (for dev server) and dist/assets (for production builds).
function copyAssets() {
  return {
    name: 'lime-copy-assets',
    configResolved() {
      syncAssetDirectories();
    },
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

// dist/index.html is what static hosting exposes, and neither Pages nor a Tauri WebView sends a
// CSP header. The entry script name is only known after Vite hashes it, so the policy is written
// after the bundle instead of being a literal in index.html.
function injectCsp() {
  return {
    name: 'lime-inject-csp',
    apply: 'build',
    closeBundle() {
      execFileSync(process.execPath, [resolve(process.cwd(), 'tools/gen-theme-meta.mjs')], { stdio: 'inherit' });
    }
  };
}

export default defineConfig({
  plugins: [vue(), copyAssets(), keepManifestUrl(), injectCsp()],
  base: './',
  publicDir: 'public',
  server: {
    host: '0.0.0.0', port: 3000, strictPort: true,
    // The editor/agent writes temporary sibling directories next to a file while saving. On
    // Windows those can stay locked for a moment, and Vite's watcher then crashes with EBUSY.
    watch: { ignored: ['**/*.tmpdir/**', '**/.*.tmpdir/**'] }
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' }
});
