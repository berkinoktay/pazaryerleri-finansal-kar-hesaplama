// Asserts every workspace package (apps/*, packages/*) declares a `lint` script.
// turbo silently no-ops a package that has no matching script, so a new package
// without a `lint` script would be excluded from `turbo run lint` (and therefore
// check:all + CI) without any error -- the exact gap that left the profit engine,
// crypto, and marketplace adapters unlinted (issue #255). This guard makes that
// regression fail loudly instead.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_DIRS = ['apps', 'packages'] as const;

// Workspaces that legitimately have nothing to lint.
const EXEMPT = new Set<string>([
  '@pazarsync/eslint-config', // the shared flat config itself
]);

const missing: string[] = [];

for (const dir of WORKSPACE_DIRS) {
  const base = path.join(ROOT, dir);
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(base, entry.name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    const name = pkg.name ?? `${dir}/${entry.name}`;
    if (EXEMPT.has(name)) continue;
    if (pkg.scripts?.['lint'] === undefined) {
      missing.push(name);
    }
  }
}

if (missing.length > 0) {
  console.error(
    'Lint-coverage audit failed — these workspaces have no `lint` script ' +
      '(turbo would silently skip them):\n' +
      missing.map((m) => `  - ${m}`).join('\n') +
      '\nAdd `"lint": "eslint ."` + an eslint.config.mjs re-exporting @pazarsync/eslint-config.',
  );
  process.exit(1);
}

console.log('Lint-coverage audit — every workspace declares a lint script.');
