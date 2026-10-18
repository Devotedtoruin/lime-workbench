import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The project keeps its hand-made SVG/PNG library in /assets. Vite serves it in dev
// (root-relative URLs) and this plugin copies it verbatim for the production build.
function copyStatic() {
  return {
    name: 'lime-copy-static',
    apply: 'build',
    closeBundle() {
      const root = process.cwd();
      if (existsSync(resolve(root, 'assets'))) cpSync(resolve(root, 'assets'), resolve(root, 'dist/assets'), { recursive: true });
      for (const file of ['manifest.webmanifest', 'sw.js']) {
        if (existsSync(resolve(root, file))) cpSync(resolve(root, file), resolve(root, 'dist', file));
      }
    }
  };
}

export default defineConfig({
  plugins: [vue(), copyStatic()],
  publicDir: false,
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' }
});
