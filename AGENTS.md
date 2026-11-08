# lime-workbench

Vue 3 + Vite 8 local-first personal workbench at `D:\XSoftwae\Github\lime-workbench`.
Web / PWA is the current delivery path: Vue UI and composables live in `src/`, business modules in `js/`, and browser storage holds local data. Weather and OpenAI-compatible AI are optional network features; saved weather coordinates refresh at startup, and saving a valid AI configuration reads `/models` when `autoModels` is enabled (default). [src-tauri/](src-tauri/) contains Tauri 2 project configuration only; native builds and releases remain unverified.

## Verify

- Node.js 22.12+; GitHub Actions uses Node.js 24.
- `npm test` — Node.js Test Runner (`node --test tests/*.test.mjs`), not Vitest.
- `npm run build` / `npm run build:static` — production static build with generated CSP and theme metadata.
- `npm run dev` — local development server on port 3000; Service Worker is disabled in development.

## Rules

- Do not push or deploy without explicit approval.
- Keep changes scoped to this repository; do not touch `dist/` by hand.
- The generated CSP uses an HTML meta tag; `frame-ancestors` requires an HTTP response header and is not enforced through meta.
- Use `feat:` / `fix:` / `docs:` / `style:` / `ci:` / `test:` / `chore:` commit prefixes.
