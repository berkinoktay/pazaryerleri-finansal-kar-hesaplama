#!/usr/bin/env tsx
/**
 * Feature-boundary audit.
 *
 * Scans `apps/web/src/features/<X>/...` and reports every import statement
 * that targets a different feature. Each cross-feature edge is classified by
 * `evaluateCrossFeatureImport` (see `audit-feature-boundaries.config.ts`).
 *
 * Exit codes:
 *   0 — no errors (warnings allowed)
 *   1 — at least one error-severity edge
 *   2 — script could not run (missing dir, parse failure, etc.)
 *
 * Usage:
 *   pnpm audit:boundaries
 *   pnpm audit:boundaries --json   (machine-readable output)
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateCrossFeatureImport } from './audit-feature-boundaries.config';
import type {
  AuditReport,
  CrossFeatureImport,
  Severity,
  ViolationDecision,
} from './audit-feature-boundaries.types';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const FEATURES_DIR = resolve(REPO_ROOT, 'apps/web/src/features');

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);
const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist', '__tests__']);

/**
 * Matches `import ... from '...'` statements, capturing:
 *   group 1: the optional `type` modifier on the whole statement
 *   group 2: the import path
 *
 * Tolerates multi-line specifier lists via `[^]`. We compute line numbers
 * from the match index so the report points at the right location.
 */
const IMPORT_PATTERN = /import\s+(type\s+)?(?:[^]*?)from\s+['"]([^'"]+)['"]/g;
const TYPE_ONLY_SPECIFIER_PATTERN = /\{\s*type\s+/;

interface Walked {
  absPath: string;
  relPath: string;
  feature: string;
}

async function walk(dir: string, sourceFeature: string, out: Walked[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), sourceFeature, out);
      continue;
    }
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    const absPath = join(dir, entry.name);
    out.push({
      absPath,
      relPath: relative(REPO_ROOT, absPath),
      feature: sourceFeature,
    });
  }
}

async function listFeatures(): Promise<string[]> {
  const entries = await readdir(FEATURES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

function lineNumberFromIndex(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function parseImports(source: string, file: Walked): CrossFeatureImport[] {
  const found: CrossFeatureImport[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const whole = match[0];
    const typeKeyword = match[1];
    const path = match[2];
    const matchIndex = match.index ?? 0;

    if (!path.startsWith('@/features/')) continue;
    const targetFeature = path.slice('@/features/'.length).split('/')[0];
    if (!targetFeature || targetFeature === file.feature) continue;

    const isTypeOnly = Boolean(typeKeyword) || TYPE_ONLY_SPECIFIER_PATTERN.test(whole);

    found.push({
      sourceFeature: file.feature,
      targetFeature,
      isTypeOnly,
      importPath: path,
      file: file.relPath,
      line: lineNumberFromIndex(source, matchIndex),
    });
  }
  return found;
}

async function audit(): Promise<AuditReport> {
  const features = await listFeatures();
  const files: Walked[] = [];
  for (const feature of features) {
    const featureDir = join(FEATURES_DIR, feature);
    const featureStat = await stat(featureDir);
    if (!featureStat.isDirectory()) continue;
    await walk(featureDir, feature, files);
  }

  const edges: CrossFeatureImport[] = [];
  for (const file of files) {
    const source = await readFile(file.absPath, 'utf8');
    edges.push(...parseImports(source, file));
  }

  const errors: AuditReport['errors'] = [];
  const warnings: AuditReport['warnings'] = [];
  const allowed: AuditReport['allowed'] = [];

  for (const edge of edges) {
    const decision = evaluateCrossFeatureImport(edge);
    const entry = { ...edge, decision };
    if (decision.severity === 'error') errors.push(entry);
    else if (decision.severity === 'warn') warnings.push(entry);
    else allowed.push(entry);
  }

  return { scanned: files.length, edges, errors, warnings, allowed };
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
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  error: color('ERROR', 'red'),
  warn: color('WARN', 'yellow'),
  allow: color('ALLOW', 'green'),
};

function formatEdge(edge: CrossFeatureImport, decision: ViolationDecision): string {
  const head = `${SEVERITY_LABEL[decision.severity]}  ${edge.file}:${edge.line}`;
  const arrow = `  ${color(edge.sourceFeature, 'bold')} -> ${color(edge.targetFeature, 'bold')}${edge.isTypeOnly ? color(' (type-only)', 'dim') : ''}`;
  const path = `  ${color(edge.importPath, 'dim')}`;
  const reason = `  ${decision.message}`;
  return [head, arrow, path, reason].join('\n');
}

function printHumanReport(report: AuditReport): void {
  const totalIssues = report.errors.length + report.warnings.length;

  if (totalIssues === 0) {
    console.log(
      color(
        `\nFeature-boundary audit clean - scanned ${report.scanned} files, no cross-feature imports.\n`,
        'green',
      ),
    );
    return;
  }

  console.log(
    `\nFeature-boundary audit - scanned ${report.scanned} files, found ${report.edges.length} cross-feature edge(s).\n`,
  );

  for (const entry of report.errors) {
    console.log(formatEdge(entry, entry.decision));
    console.log('');
  }
  for (const entry of report.warnings) {
    console.log(formatEdge(entry, entry.decision));
    console.log('');
  }

  const summary = [
    `${report.errors.length} error(s)`,
    `${report.warnings.length} warning(s)`,
    `${report.allowed.length} allowed`,
  ].join('  -  ');
  console.log(color(summary, 'bold'));

  if (report.errors.length > 0) {
    console.log(
      color(
        '\nPromote the symbols listed above to apps/web/src/lib/ (utils) or apps/web/src/components/patterns/ (components). See CLAUDE.md -> "Promotion Rules".\n',
        'dim',
      ),
    );
  }
}

async function main(): Promise<void> {
  const wantJson = process.argv.includes('--json');
  const report = await audit().catch((err: unknown) => {
    console.error(color(`audit-feature-boundaries: ${String(err)}`, 'red'));
    process.exit(2);
  });

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  process.exit(report.errors.length > 0 ? 1 : 0);
}

await main();
