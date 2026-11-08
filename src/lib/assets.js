// Icons and weather images are copied to dist/assets by the build, outside Vite's asset
// pipeline, so templates reference them at runtime. Root-absolute paths such as
// /assets/icons/x.svg break sub-path hosting (https://user.github.io/lime-workbench/): the
// browser resolves them against the domain root and gets a 404.
//
// BASE_URL is './' at build time, which keeps every URL relative to the document. The same
// build then works at a domain root and under a repository path.
const BASE = import.meta.env.BASE_URL || './';

export function asset(path) {
  return BASE + String(path).replace(/^\/+/, '');
}
