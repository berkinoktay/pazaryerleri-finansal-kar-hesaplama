#!/usr/bin/env tsx
/**
 * No-internal-barrel audit.
 *
 * House rule (CLAUDE.md / AGENTS.md): "No barrel exports except at package
 * boundaries." A barrel -- a file whose body is nothing but `export ... from`
 * re-exports -- is fine as a package's public entry (the file other workspaces
 * import), but an *internal* barrel (a nested `index.ts` that just re-exports
 * siblings) creates import-cycle risk, defeats tree-shaking, and hides where a
 * symbol actually lives. That rule lived only in prose; this gate enforces it.
 *
 * For each package under packages/*, the legitimate entry files are derived
 * from its package.json (`main`, `types`, and every target in `exports`) -- no
 * hard-coded index list. Any pure re-export file under src/ that is NOT a
 * declared entry is a violation.
 *
 * Scope is packages/* (the shared, importable workspaces). apps/* are leaf
 * applications without an export surface and are out of scope here. Test/fixture
 * directories (`__tests__` / `__fixtures__` / `__mocks__`) are not scanned.
 *
 * Known blind spots (conservative by design, to avoid false positives):
 *   - Only a *pure* re-export file is flagged. A file that re-exports siblings
 *     plus one own declaration (a local const/type) is not a "pure" barrel and
 *     is left alone.
 *   - An import-then-local-re-export (`import { X } from './a'; export { X };`)
 *     is functionally a barrel but has no `export ... from`, so it is not
 *     detected. Latent today (no such file in packages/*).
 *
 * Exit codes: 0 clean, 1 violation(s), 2 could not run.
 *
 * Usage: pnpm audit:no-barrel
 *
 * To allow a deliberate internal barrel, add its repo-relative path to
 * ALLOWED_BARRELS with a reason.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

/** Repo-relative internal barrels that are intentional. Empty today. */
const ALLOWED_BARRELS = new Set<string>([]);

/** Directories that hold tests/fixtures, not importable source -- never scanned. */
const EXCLUDED_DIRS = new Set(['__tests__', '__fixtures__', '__mocks__']);

interface PackageJson {
  main?: string;
  types?: string;
  exports?: unknown;
}

/** Collect every string target reachable in an `exports` field (string, map, or conditions). */
function collectExportTargets(exports: unknown, acc: string[]): void {
  if (typeof exports === 'string') {
    acc.push(exports);
  } else if (exports !== null && typeof exports === 'object') {
    for (const value of Object.values(exports as Record<string, unknown>)) {
      collectExportTargets(value, acc);
    }
  }
}

function entryFilesFor(pkgDir: string, pkg: PackageJson): Set<string> {
  const specifiers: string[] = [];
  if (pkg.main !== undefined) specifiers.push(pkg.main);
  if (pkg.types !== undefined) specifiers.push(pkg.types);
  collectExportTargets(pkg.exports, specifiers);
  return new Set(specifiers.map((s) => path.resolve(pkgDir, s)));
}

function listSourceFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      listSourceFiles(abs, acc);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      acc.push(abs);
    }
  }
}

// The named-export brace body is `[^{}]*?` (not `[\s\S]*?`): named re-exports
// never nest braces, and forbidding `{`/`}` inside stops the match from bridging
// across a statement boundary (e.g. a standalone local `export { X };` followed
// by a real `export { Y } from './y'`) and swallowing the local export.
const REEXPORT_RE =
  /export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^{}]*?\})\s+from\s+(['"])[^'"]+\1\s*;?/g;
const IMPORT_RE =
  /import\s+(?:type\s+)?[\s\S]*?from\s+(['"])[^'"]+\1\s*;?|import\s+(['"])[^'"]+\2\s*;?/g;

/** Strip block + line comments (re-export paths never contain `//`, so this is safe here). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * True iff the file is a pure barrel: it has at least one `export ... from`
 * re-export and, once imports and re-exports are removed, nothing but
 * whitespace remains (no own declarations, statements, or local exports).
 */
function isPureBarrel(absFile: string): boolean {
  const code = stripComments(readFileSync(absFile, 'utf8'));
  REEXPORT_RE.lastIndex = 0;
  const reexportCount = (code.match(REEXPORT_RE) ?? []).length;
  if (reexportCount === 0) return false;
  const residue = code.replace(REEXPORT_RE, '').replace(IMPORT_RE, '').trim();
  return residue === '';
}

function main(): void {
  if (!existsSync(PACKAGES_DIR)) {
    console.error('audit-barrels: packages/ directory not found');
    process.exit(2);
  }

  const violations: string[] = [];

  // A malformed package.json or any read failure is a tooling error (exit 2),
  // not a barrel finding (exit 1) -- keep the two distinguishable in CI.
  try {
    for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgDir = path.join(PACKAGES_DIR, entry.name);
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      const srcDir = path.join(pkgDir, 'src');
      if (!existsSync(pkgJsonPath) || !existsSync(srcDir)) continue;

      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJson;
      const entryFiles = entryFilesFor(pkgDir, pkg);

      const files: string[] = [];
      listSourceFiles(srcDir, files);

      for (const file of files) {
        if (entryFiles.has(file)) continue;
        const rel = path.relative(ROOT, file);
        if (ALLOWED_BARRELS.has(rel)) continue;
        if (isPureBarrel(file)) violations.push(rel);
      }
    }
  } catch (err) {
    console.error(`audit-barrels: ${String(err)}`);
    process.exit(2);
  }

  if (violations.length > 0) {
    console.error(
      'No-barrel audit failed -- these internal files are pure `export ... from` ' +
        'barrels but are not declared package entries:\n' +
        violations.map((v) => `  - ${v}`).join('\n') +
        '\nMove each symbol to its real module and import it directly, or (if a ' +
        'package boundary) declare the file in package.json `exports`. To keep an ' +
        'intentional internal barrel, add it to ALLOWED_BARRELS in scripts/audit-barrels.ts.',
    );
    process.exit(1);
  }

  console.log('No-barrel audit -- no internal barrel files in packages/*.');
}

main();
