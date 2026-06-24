#!/usr/bin/env tsx
/**
 * Test reference-data hygiene audit.
 *
 * The shipping reference tables (shipping_carriers, shipping_desi_tariffs,
 * shipping_barem_tariffs) are a READ-ONLY global fixture seeded once per
 * integration package by globalSetup (@pazarsync/db/test-support). No test may
 * TRUNCATE them: every package's integration tests share one CI Postgres
 * (`turbo run test:integration --concurrency=1`), so wiping the catalogue in one
 * suite empties it for every later suite, making `list-carriers`' "exactly 10"
 * assertion order-dependent. That is the exact bug this gate prevents from
 * regressing.
 *
 * The gate scans every TS file under apps/ and packages/ for a `TRUNCATE TABLE`
 * statement that lists any of the three shipping tables and fails if one is
 * found. Notes:
 *   - fee_definitions / marketplace_commission_rate are intentionally truncated
 *     + re-seeded per test (consistent empty-ground tables) — NOT covered here.
 *   - own_shipping_tariffs is tenant data, legitimately truncated — the exact
 *     word-boundary match never confuses it with shipping_*_tariffs.
 *   - Pruning test strays via DELETE (the fixture helper) is allowed; only
 *     TRUNCATE of the fixture is forbidden.
 *
 * Exit codes: 0 clean, 1 violation(s), 2 could not run.
 * Usage: pnpm audit:test-hygiene
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['apps', 'packages'];
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'generated', '.turbo']);

/**
 * Read-only global fixture tables that no TRUNCATE may list. Seeded once per
 * integration package by globalSetup (@pazarsync/db/test-support); wiping any of
 * them in one suite empties it for every later suite under the shared CI Postgres.
 * micro_export_return_fee_tiers is the micro-export "Yurt Dışı İade Operasyon Bedeli"
 * tier catalogue — same read-only-fixture contract as the shipping tables.
 */
const FORBIDDEN_TABLES = [
  'shipping_carriers',
  'shipping_desi_tariffs',
  'shipping_barem_tariffs',
  'micro_export_return_fee_tiers',
];

// Capture each `TRUNCATE TABLE ...` statement body up to its first terminator
// (RESTART IDENTITY / CASCADE / `;` / closing template backtick).
const TRUNCATE_RE = /TRUNCATE\s+TABLE([\s\S]*?)(?:RESTART\s+IDENTITY|CASCADE|;|`)/gi;

function listTsFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      listTsFiles(abs, acc);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      acc.push(abs);
    }
  }
}

interface Violation {
  file: string;
  table: string;
}

function scanFile(absFile: string): Violation[] {
  const src = readFileSync(absFile, 'utf8');
  if (!src.includes('TRUNCATE')) return [];

  const found: Violation[] = [];
  for (const match of src.matchAll(TRUNCATE_RE)) {
    const body = match[1] ?? '';
    for (const table of FORBIDDEN_TABLES) {
      if (new RegExp(`\\b${table}\\b`).test(body)) {
        found.push({ file: path.relative(ROOT, absFile), table });
      }
    }
  }
  return found;
}

function main(): void {
  const files: string[] = [];
  try {
    for (const dir of SCAN_DIRS) {
      const abs = path.join(ROOT, dir);
      if (existsSync(abs)) listTsFiles(abs, files);
    }
  } catch (err) {
    console.error(`audit-test-reference-hygiene: ${String(err)}`);
    process.exit(2);
  }

  const violations = files.flatMap(scanFile);
  if (violations.length > 0) {
    console.error(
      'Test reference-data hygiene audit failed — these files TRUNCATE a read-only\n' +
        'shipping reference fixture table. It is seeded once via\n' +
        '@pazarsync/db/test-support and shared across every suite on the CI Postgres,\n' +
        'so truncating it makes list-carriers order-dependent:\n' +
        violations.map((v) => `  - ${v.file} → TRUNCATE ... ${v.table}`).join('\n') +
        '\nRemove the shipping table(s) from the TRUNCATE list. Tests that need a\n' +
        'carrier should look one up by code (e.g. SENDEOMP), not create or wipe it.',
    );
    process.exit(1);
  }

  console.log(
    'Test reference-data hygiene audit — no TRUNCATE of shipping reference fixture tables.',
  );
}

main();
