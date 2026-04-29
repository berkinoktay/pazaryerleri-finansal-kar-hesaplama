#!/usr/bin/env tsx
/**
 * Error-code drift audit.
 *
 * Reads every source-of-truth list of RFC 7807 / domain error codes and
 * cross-references them. Reports missing translations, orphaned
 * translation keys, language drift between TR and EN, missing branches
 * in `problem-details.ts`, and missing entries in the QueryProvider's
 * `KNOWN_CODES` toast pipeline.
 *
 * Sources scanned:
 *   - packages/sync-core/src/errors.ts          (domain class codes — sync)
 *   - apps/api/src/lib/errors.ts                (domain class codes — api)
 *   - apps/api/src/lib/problem-details.ts       (outbound HTTP codes)
 *   - apps/web/src/lib/api-error.ts             (client-emitted codes)
 *   - apps/web/src/providers/query-provider.tsx (KNOWN_CODES toast set)
 *   - apps/web/messages/tr.json                 (TR translations)
 *   - apps/web/messages/en.json                 (EN translations)
 *
 * Drift edges (severity in parens):
 *   1. (error) domain-class codes ⊄ problem-details
 *      → app.onError falls through to 500 INTERNAL_ERROR instead of the typed code
 *   2. (error) emit-site codes ⊄ TR translations
 *      → toast falls to 'generic' (silent UX bug)
 *   3. (error) TR keys ≠ EN keys
 *      → language drift; one locale shows the raw key string
 *   4. (error) emit-site codes ⊄ KNOWN_CODES ∪ SILENT_CODES
 *      → toast falls to 'generic' (silent UX bug)
 *   5. (warn)  TR keys ⊄ emit-sites ∪ SILENT_CODES ∪ I18N_SPECIALS
 *      → orphaned translation key (cleanup candidate)
 *
 * Exit codes:
 *   0 — no errors (warnings allowed)
 *   1 — at least one error-severity drift
 *   2 — script could not run (missing source file, parse failure, etc.)
 *
 * Usage:
 *   pnpm audit:errors
 *   pnpm audit:errors --json   (machine-readable output)
 *
 * Tune strictness by editing `audit-error-codes.config.ts` (SILENT_CODES,
 * I18N_SPECIALS). The runner does not need to change.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { I18N_SPECIALS, SILENT_CODES } from './audit-error-codes.config';
import type { AuditReport, ErrorCodeViolation, Severity } from './audit-error-codes.types';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

const SOURCES = {
  syncCoreErrors: 'packages/sync-core/src/errors.ts',
  apiErrors: 'apps/api/src/lib/errors.ts',
  problemDetails: 'apps/api/src/lib/problem-details.ts',
  apiErrorClient: 'apps/web/src/lib/api-error.ts',
  queryProvider: 'apps/web/src/providers/query-provider.tsx',
  trMessages: 'apps/web/messages/tr.json',
  enMessages: 'apps/web/messages/en.json',
} as const;

/**
 * Captures `readonly code = SyncErrorCode.X` OR `readonly code = 'X' as const`
 * (with `as const` optional). Used for domain error class declarations in
 * `errors.ts` files.
 */
const DOMAIN_CODE_PATTERN =
  /readonly\s+code\s*=\s*(?:SyncErrorCode\.(\w+)|'(\w+)'(?:\s+as\s+const)?)/g;

/**
 * Captures `code: SyncErrorCode.X` OR `code: 'X'` in object-literal positions
 * (response builders in `problem-details.ts`, ApiError constructors in
 * `api-error.ts`).
 */
const OBJECT_CODE_PATTERN = /code:\s*(?:SyncErrorCode\.(\w+)|'(\w+)')/g;

/**
 * Captures the entire `[...]` array literal that initializes the
 * `KNOWN_CODES` Set. The contents are then re-scanned for string literals.
 */
const KNOWN_CODES_BLOCK_PATTERN = /const\s+KNOWN_CODES[^=]*=\s*new\s+Set[^[]*\[([^\]]+)\]/;

const STRING_LITERAL_PATTERN = /'(\w+)'/g;

function extractCodesViaPattern(source: string, pattern: RegExp): Set<string> {
  const out = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const code = match[1] ?? match[2];
    if (code) out.add(code);
  }
  return out;
}

function extractKnownCodesSet(source: string): Set<string> {
  const blockMatch = source.match(KNOWN_CODES_BLOCK_PATTERN);
  if (!blockMatch) return new Set();
  const out = new Set<string>();
  for (const match of blockMatch[1].matchAll(STRING_LITERAL_PATTERN)) {
    out.add(match[1]);
  }
  return out;
}

function extractTranslationKeys(json: string): Set<string> {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) return new Set();
  const common = (parsed as { common?: { errors?: Record<string, unknown> } }).common;
  if (common === undefined || common.errors === undefined) return new Set();
  return new Set(Object.keys(common.errors));
}

interface AuditInput {
  syncCoreClassCodes: Set<string>;
  apiClassCodes: Set<string>;
  problemDetailsCodes: Set<string>;
  clientEmittedCodes: Set<string>;
  knownCodes: Set<string>;
  trKeys: Set<string>;
  enKeys: Set<string>;
}

async function loadInputs(): Promise<AuditInput> {
  const [syncCoreErrors, apiErrors, problemDetails, apiErrorClient, queryProvider, trJson, enJson] =
    await Promise.all([
      readFile(resolve(REPO_ROOT, SOURCES.syncCoreErrors), 'utf8'),
      readFile(resolve(REPO_ROOT, SOURCES.apiErrors), 'utf8'),
      readFile(resolve(REPO_ROOT, SOURCES.problemDetails), 'utf8'),
      readFile(resolve(REPO_ROOT, SOURCES.apiErrorClient), 'utf8'),
      readFile(resolve(REPO_ROOT, SOURCES.queryProvider), 'utf8'),
      readFile(resolve(REPO_ROOT, SOURCES.trMessages), 'utf8'),
      readFile(resolve(REPO_ROOT, SOURCES.enMessages), 'utf8'),
    ]);

  return {
    syncCoreClassCodes: extractCodesViaPattern(syncCoreErrors, DOMAIN_CODE_PATTERN),
    apiClassCodes: extractCodesViaPattern(apiErrors, DOMAIN_CODE_PATTERN),
    problemDetailsCodes: extractCodesViaPattern(problemDetails, OBJECT_CODE_PATTERN),
    clientEmittedCodes: extractCodesViaPattern(apiErrorClient, OBJECT_CODE_PATTERN),
    knownCodes: extractKnownCodesSet(queryProvider),
    trKeys: extractTranslationKeys(trJson),
    enKeys: extractTranslationKeys(enJson),
  };
}

function audit(input: AuditInput): AuditReport {
  const errors: ErrorCodeViolation[] = [];
  const warnings: ErrorCodeViolation[] = [];

  // Union of every place a code can originate before reaching the frontend's
  // `error.code` (server-emitted ∪ client-emitted).
  const emitSites = new Set([
    ...input.syncCoreClassCodes,
    ...input.apiClassCodes,
    ...input.problemDetailsCodes,
    ...input.clientEmittedCodes,
  ]);

  // Edge 1: domain-class codes ⊄ problem-details (error)
  const allDomainClassCodes = new Set([...input.syncCoreClassCodes, ...input.apiClassCodes]);
  for (const code of allDomainClassCodes) {
    if (input.problemDetailsCodes.has(code)) continue;
    errors.push({
      severity: 'error',
      kind: 'missing_problem_details_branch',
      code,
      message: `Domain error class with code '${code}' has no branch in apps/api/src/lib/problem-details.ts — app.onError would fall through to 500 INTERNAL_ERROR instead of returning the typed code`,
    });
  }

  // Edge 2: emit-site codes ⊄ TR translations (error)
  for (const code of emitSites) {
    if (input.trKeys.has(code)) continue;
    errors.push({
      severity: 'error',
      kind: 'missing_translation_tr',
      code,
      message: `Code '${code}' is emitted but has no Turkish translation under common.errors in apps/web/messages/tr.json — toast falls to 'generic'`,
    });
  }

  // Edge 3: TR keys ≠ EN keys (error)
  for (const code of input.trKeys) {
    if (input.enKeys.has(code)) continue;
    errors.push({
      severity: 'error',
      kind: 'language_drift_missing_en',
      code,
      message: `Code '${code}' has TR translation but no EN translation — EN-locale users see the raw key string`,
    });
  }
  for (const code of input.enKeys) {
    if (input.trKeys.has(code)) continue;
    errors.push({
      severity: 'error',
      kind: 'language_drift_missing_tr',
      code,
      message: `Code '${code}' has EN translation but no TR translation — TR-locale users see the raw key string`,
    });
  }

  // Edge 4: emit-site codes ⊄ KNOWN_CODES ∪ SILENT_CODES (error)
  for (const code of emitSites) {
    if (input.knownCodes.has(code)) continue;
    if (SILENT_CODES.has(code)) continue;
    errors.push({
      severity: 'error',
      kind: 'missing_known_codes',
      code,
      message: `Code '${code}' is emitted but is neither in KNOWN_CODES (toast pipeline) nor SILENT_CODES (intentionally silenced) — toast falls to 'generic'`,
    });
  }

  // Edge 5: TR keys ⊄ emit-sites ∪ SILENT_CODES ∪ I18N_SPECIALS (warn)
  for (const code of input.trKeys) {
    if (emitSites.has(code)) continue;
    if (SILENT_CODES.has(code)) continue;
    if (I18N_SPECIALS.has(code)) continue;
    warnings.push({
      severity: 'warn',
      kind: 'orphaned_translation',
      code,
      message: `Translation key '${code}' has no emit site (no domain class, problem-details branch, or client-emitted reference) — orphaned entry, cleanup candidate`,
    });
  }

  return {
    sources: Object.values(SOURCES),
    errors,
    warnings,
  };
}

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function color(text: string, c: keyof typeof COLORS): string {
  if (process.env['NO_COLOR'] !== undefined || !process.stdout.isTTY) return text;
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  error: color('ERROR', 'red'),
  warn: color('WARN', 'yellow'),
};

function formatViolation(v: ErrorCodeViolation): string {
  const head = `${SEVERITY_LABEL[v.severity]}  ${color(v.code, 'bold')}  ${color(`(${v.kind})`, 'dim')}`;
  const body = `  ${v.message}`;
  return [head, body].join('\n');
}

function printHumanReport(report: AuditReport): void {
  const total = report.errors.length + report.warnings.length;

  if (total === 0) {
    console.log(
      color(
        `\nError-code audit clean — scanned ${report.sources.length.toString()} sources, no drift detected.\n`,
        'green',
      ),
    );
    return;
  }

  console.log(
    `\nError-code audit — scanned ${report.sources.length.toString()} sources, found ${total.toString()} drift edge(s).\n`,
  );

  for (const v of report.errors) {
    console.log(formatViolation(v));
    console.log('');
  }
  for (const v of report.warnings) {
    console.log(formatViolation(v));
    console.log('');
  }

  const summary = [
    `${report.errors.length.toString()} error(s)`,
    `${report.warnings.length.toString()} warning(s)`,
  ].join('  -  ');
  console.log(color(summary, 'bold'));

  if (report.errors.length > 0) {
    console.log(
      color(
        '\nFix drift before merge: add missing translations, KNOWN_CODES entries, or problem-details branches.\nTo silence a code intentionally, edit scripts/audit-error-codes.config.ts (SILENT_CODES / I18N_SPECIALS).\n',
        'dim',
      ),
    );
  }
}

async function main(): Promise<void> {
  const wantJson = process.argv.includes('--json');

  let report: AuditReport;
  try {
    const input = await loadInputs();
    report = audit(input);
  } catch (err) {
    console.error(color(`audit-error-codes: ${String(err)}`, 'red'));
    process.exit(2);
  }

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  process.exit(report.errors.length > 0 ? 1 : 0);
}

await main();
