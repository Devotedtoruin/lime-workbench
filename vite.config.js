import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const ASSET_MIME = {
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8'
};

// The hand-made SVG/PNG library lives in /assets (icons, weather images). Serve it directly
// during dev without duplicating files into public/assets, and copy into dist/assets on build.
function copyAssets() {
  return {
    name: 'lime-copy-assets',
    configureServer(server) {
      const assetsRoot = resolve(process.cwd(), 'assets');
      server.middlewares.use('/assets', (req, res, next) => {
        if (!req.url || !['GET', 'HEAD'].includes(req.method || 'GET')) return next();
        const rawPath = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
        const filePath = resolve(assetsRoot, rawPath);
        if (filePath !== assetsRoot && !filePath.startsWith(assetsRoot + sep)) return next();
        if (!existsSync(filePath) || !statSync(filePath).isFile()) return next();
        const ext = extname(filePath).toLowerCase();
        if (ASSET_MIME[ext]) res.setHeader('Content-Type', ASSET_MIME[ext]);
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') {
          res.statusCode = 200;
          res.end();
          return;
        }
        createReadStream(filePath).pipe(res);
      });
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
