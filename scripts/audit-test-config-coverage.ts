// Test-config coverage audit. Three ways a test silently stops running — or
// runs uncapped — that nothing else catches:
//
// 1. A vitest config that does not take its pool size from
//    `@pazarsync/vitest-config` runs with one worker per core and brings back
//    the machine-freezing oversubscription (and lets VITEST_MAX_WORKERS
//    override fileParallelism:false on DB-backed suites).
// 2. A package that runs vitest without any config file gets vitest's
//    defaults for the same reason.
// 3. In packages whose suites are split by directory, a test file outside
//    those directories matches no config and never runs. Five api tests under
//    src/**/__tests__ sat unnoticed that way.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_DIRS = ['apps', 'packages'] as const;
const VITEST_CONFIG_RE = /^vitest(\.[a-z]+)?\.config\.ts$/;
const TEST_FILE_RE = /\.test\.tsx?$/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'generated']);
const POLICY_IMPORT = "from '@pazarsync/vitest-config'";
const POLICY_CALL = 'testWorkers()';

// The policy package defines testWorkers() itself; its one test file needs no cap.
const EXEMPT_PACKAGES = new Set<string>(['@pazarsync/vitest-config']);

// Packages whose unit / integration / component configs are split by
// directory: every test file must live under one of these roots.
const TEST_ROOTS: Readonly<Record<string, readonly string[]>> = {
  'apps/api': ['tests/unit/', 'tests/integration/'],
  'apps/sync-worker': ['tests/unit/', 'tests/integration/'],
  'apps/web': ['tests/unit/', 'tests/component/'],
  'packages/sync-core': ['src/', 'tests/integration/'],
  'packages/db': ['src/', 'tests/'],
};

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

function isPackageJson(value: unknown): value is PackageJson {
  return typeof value === 'object' && value !== null;
}

function readPackageJson(file: string): PackageJson {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isPackageJson(parsed)) throw new Error(`${file} is not a JSON object`);
  return parsed;
}

function listTestFiles(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      found.push(...listTestFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (TEST_FILE_RE.test(entry.name)) {
      found.push(`${prefix}${entry.name}`);
    }
  }
  return found;
}

const violations: string[] = [];

for (const workspaceDir of WORKSPACE_DIRS) {
  const base = path.join(ROOT, workspaceDir);
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(base, entry.name);
    const pkgFile = path.join(pkgDir, 'package.json');
    if (!existsSync(pkgFile)) continue;
    const relDir = `${workspaceDir}/${entry.name}`;
    const pkg = readPackageJson(pkgFile);
    const name = pkg.name ?? relDir;
    if (EXEMPT_PACKAGES.has(name)) continue;

    const runsVitest = Object.values(pkg.scripts ?? {}).some((script) => script.includes('vitest'));
    const configs = readdirSync(pkgDir).filter((file) => VITEST_CONFIG_RE.test(file));

    if (runsVitest && configs.length === 0) {
      violations.push(`${relDir}: runs vitest but has no vitest*.config.ts (rule 2)`);
    }
    for (const config of configs) {
      const source = readFileSync(path.join(pkgDir, config), 'utf8');
      if (!source.includes(POLICY_IMPORT) || !source.includes(POLICY_CALL)) {
        violations.push(
          `${relDir}/${config}: must import testWorkers ${POLICY_IMPORT} and set maxWorkers: ${POLICY_CALL} (rule 1)`,
        );
      }
    }

    const roots = TEST_ROOTS[relDir];
    if (roots === undefined) continue;
    for (const file of listTestFiles(pkgDir)) {
      if (!roots.some((root) => file.startsWith(root))) {
        violations.push(
          `${relDir}/${file}: outside ${roots.join(', ')} — no config runs it (rule 3)`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    'Test-config coverage audit failed:\n' +
      violations.map((v) => `  - ${v}`).join('\n') +
      '\nSee scripts/audit-test-config-coverage.ts for the rules.',
  );
  process.exit(1);
}

console.log(
  'Test-config coverage audit — every vitest config is capped and every test file is reachable.',
);
