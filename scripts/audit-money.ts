#!/usr/bin/env tsx
/**
 * Money-coercion audit (decimal.js invariant).
 *
 * PazarSync's core promise is real profitability, computed in decimal.js end
 * to end -- never floating point. A single `Number(...)`, `parseFloat(...)`,
 * `parseInt(...)`, `.toNumber()`, or unary `+` coercion inside the money core
 * silently turns a Decimal into an IEEE-754 float and reintroduces rounding
 * error (the classic `100.10 - 23.64 - 29.99 = 46.46999999999999`). That rule
 * lived only in prose (CLAUDE.md / AGENTS.md); prose rules rot, gates do not.
 *
 * This gate scans the Decimal-only surface (see ROOTS in the config) and fails
 * the build on any numeric-coercion token. Comment, string, and regex-literal
 * contents are masked before matching, so a coercion mentioned in a doc comment,
 * string, or regex is not flagged -- and a quote inside a regex does not hide a
 * later real coercion. Math.round/floor/ceil/trunc on a Decimal are caught
 * transitively via their inner coercion token (`Number(` / `.toNumber(` / `+`).
 * The one accepted blind spot is template interpolation (`${ ... }`), masked
 * wholesale; the money core does not build strings from coerced numbers. Test
 * helpers under `__tests__` / `__fixtures__` directories are not scanned.
 *
 * Scope is deliberately narrow (packages/profit + packages/order-sync): the
 * money math lives there, and those packages are coercion-free today, so the
 * gate starts green and only fires on a regression. apps/api services
 * legitimately coerce integer counts and the desi tier and are intentionally
 * out of scope -- widening ROOTS requires an ALLOWED entry per non-money hit.
 *
 * Exit codes:
 *   0 -- clean (no coercion in scope)
 *   1 -- at least one coercion violation
 *   2 -- could not run (configured root missing, read failure, etc.)
 *
 * Usage:
 *   pnpm audit:money
 *   pnpm audit:money --json   (machine-readable output)
 *
 * Tune by editing scripts/audit-money.config.ts (ROOTS, ALLOWED). The runner
 * does not change to add an exemption.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALLOWED, ROOTS } from './audit-money.config';
import type { MoneyAuditReport, MoneyViolation } from './audit-money.types';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/**
 * Each coercion token to flag. `label` is what the report shows; `pattern` is
 * a global regex run against the comment/string-masked source. For `+` the
 * match captures a leading delimiter so binary addition is not flagged --
 * `plusOffset` points the reported column at the `+` itself.
 */
const COERCIONS: readonly { label: string; pattern: RegExp; plusOffset?: boolean }[] = [
  { label: 'Number(', pattern: /\bNumber\s*\(/g },
  { label: 'parseFloat(', pattern: /\bparseFloat\s*\(/g },
  { label: 'parseInt(', pattern: /\bparseInt\s*\(/g },
  // Method coercions allow an optional `?.` (optional-chaining call) between
  // the name and the paren, so `d.toNumber?.()` / `d.valueOf?.()` are not blind
  // spots. `.valueOf()` is the implicit coercion hook behind `+d` / `1 * d` and
  // is outside the blessed wire vocabulary (.toString/.toFixed/.toDecimalPlaces).
  { label: '.toNumber(', pattern: /\.toNumber\s*\??\.?\s*\(/g },
  { label: '.valueOf(', pattern: /\.valueOf\s*\??\.?\s*\(/g },
  // Unary `+` used to coerce: a `+` immediately after an assignment, opening
  // bracket, comma, colon, `return`, `=>`, or a logical operator, and directly
  // in front of an identifier/paren/number. `a + b` (binary), `++`, and `+=` do
  // not match because the `+` is preceded by an operand, not one of these
  // tokens -- and this holds across line breaks (`base\n  + shipping` is binary,
  // not a coercion), which is why a start-of-line anchor is deliberately absent.
  {
    label: 'unary +',
    pattern: /(?:[=(,[{:?;]|=>|\breturn\b|&&|\|\|)\s*\+\s*(?=[A-Za-z_($\d])/g,
    plusOffset: true,
  },
];

/** Operand-ending chars: a `/` right after one of these is division, not a regex. */
const OPERAND_BEFORE_SLASH = /[A-Za-z0-9_$)\]}]/;

/**
 * Replace the contents of line comments, block comments, string/template
 * literals, AND regex literals with spaces, preserving every character position
 * (and newlines) so a match offset maps 1:1 back to the original line/column. A
 * tiny TS lexer: enough to keep `Number(` inside `// ...`, `'...'`, or `/.../`
 * from being flagged, and -- just as important for a correctness gate -- to keep
 * a quote inside a regex (`/'/g`) from flipping into string mode and hiding a
 * real coercion that follows.
 *
 * Regex-vs-division is disambiguated by the previous significant code char: a
 * `/` after an operand (identifier, number, `)`, `]`, `}`, or a string/regex
 * result) is division; otherwise it opens a regex. The rare keyword-prefixed
 * case (`return /re/`) is read as division -- a benign false-positive direction
 * (regex body scanned as code), never a false negative.
 *
 * Template expressions (`${ ... }`) are masked wholesale with the rest of the
 * template -- a coercion inside an interpolation is not detected. The money core
 * does not build strings from coerced numbers, so this is an accepted blind
 * spot, not a live gap.
 */
function maskCommentsAndStrings(src: string): string {
  const out: string[] = [];
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template' | 'regex';
  let mode: Mode = 'code';
  // Last non-whitespace char emitted in code mode; decides regex-vs-division.
  let prevSig: string | undefined;
  // Char-class depth inside a regex: a `/` inside `[...]` does not close it.
  let classDepth = 0;
  const last = src.length - 1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    const next = src[i + 1];
    const keep = ch === '\n' ? '\n' : ' ';

    switch (mode) {
      case 'code':
        if (ch === '/' && next === '/') {
          mode = 'line';
          out.push(' ', ' ');
          i++;
        } else if (ch === '/' && next === '*') {
          mode = 'block';
          out.push(' ', ' ');
          i++;
        } else if (ch === '/' && (prevSig === undefined || !OPERAND_BEFORE_SLASH.test(prevSig))) {
          mode = 'regex';
          classDepth = 0;
          out.push(' ');
        } else if (ch === "'") {
          mode = 'single';
          out.push(' ');
        } else if (ch === '"') {
          mode = 'double';
          out.push(' ');
        } else if (ch === '`') {
          mode = 'template';
          out.push(' ');
        } else {
          out.push(ch);
          if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') prevSig = ch;
        }
        break;
      case 'line':
        out.push(keep);
        if (ch === '\n') mode = 'code';
        break;
      case 'block':
        if (ch === '*' && next === '/') {
          out.push(' ', ' ');
          i++;
          mode = 'code';
        } else {
          out.push(keep);
        }
        break;
      case 'regex':
        if (ch === '\\') {
          // Mask the escaped pair; do not over-consume if `\` is the last char.
          if (i === last) out.push(' ');
          else {
            out.push(' ', ' ');
            i++;
          }
        } else if (ch === '[') {
          classDepth++;
          out.push(' ');
        } else if (ch === ']') {
          if (classDepth > 0) classDepth--;
          out.push(' ');
        } else if (ch === '/' && classDepth === 0) {
          out.push(' ');
          mode = 'code';
          prevSig = 'x'; // a regex result is an operand: the next `/` is division
        } else if (ch === '\n') {
          // A newline cannot appear in a regex literal; treat as terminated
          // (defensive against malformed source) and resume code scanning.
          out.push('\n');
          mode = 'code';
        } else {
          out.push(' ');
        }
        break;
      case 'single':
      case 'double':
      case 'template': {
        const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
        if (ch === '\\') {
          if (i === last) out.push(' ');
          else {
            out.push(' ', ' ');
            i++;
          }
        } else if (ch === quote) {
          out.push(' ');
          mode = 'code';
          prevSig = 'x'; // a string result is an operand: the next `/` is division
        } else {
          out.push(keep);
        }
        break;
      }
      default: {
        const _exhaustive: never = mode;
        throw new Error(`Unhandled mask mode: ${String(_exhaustive)}`);
      }
    }
  }

  return out.join('');
}

/** Precompute the character offset at which each 1-based line starts. */
function lineStartOffsets(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function offsetToLineCol(offset: number, lineStarts: number[]): { line: number; column: number } {
  // Binary search for the greatest line start <= offset.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((lineStarts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - (lineStarts[lo] as number) + 1 };
}

/** Directories that hold tests/fixtures, not money core -- never scanned. */
const EXCLUDED_DIRS = new Set(['__tests__', '__fixtures__', '__mocks__']);

async function collectSourceFiles(absRoot: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(absRoot, { withFileTypes: true });
  for (const entry of entries) {
    const abs = resolve(absRoot, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...(await collectSourceFiles(abs)));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(abs);
    }
  }
  return out;
}

async function scanFile(absFile: string): Promise<MoneyViolation[]> {
  const raw = await readFile(absFile, 'utf8');
  const masked = maskCommentsAndStrings(raw);
  const lineStarts = lineStartOffsets(raw);
  const rawLines = raw.split('\n');
  const file = relative(REPO_ROOT, absFile);

  const violations: MoneyViolation[] = [];
  for (const { label, pattern, plusOffset } of COERCIONS) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const tokenOffset =
        plusOffset === true ? (match.index ?? 0) + match[0].indexOf('+') : (match.index ?? 0);
      const { line, column } = offsetToLineCol(tokenOffset, lineStarts);
      violations.push({
        severity: 'error',
        file,
        line,
        column,
        pattern: label,
        snippet: (rawLines[line - 1] ?? '').trim(),
        message: `\`${label}\` coerces a Decimal to a JS number -- money math must stay in decimal.js (use .add/.sub/.mul/.div, and .toString()/.toFixed() at the wire).`,
      });
    }
  }
  return violations;
}

async function run(): Promise<MoneyAuditReport> {
  const allowed = new Set(ALLOWED.map((a) => `${a.file}:${a.line.toString()}`));
  const violations: MoneyViolation[] = [];
  let scannedFiles = 0;

  for (const root of ROOTS) {
    const absRoot = resolve(REPO_ROOT, root);
    const rootStat = await stat(absRoot).catch(() => null);
    if (rootStat === null || !rootStat.isDirectory()) {
      throw new Error(`configured root does not exist: ${root}`);
    }
    const files = await collectSourceFiles(absRoot);
    scannedFiles += files.length;
    for (const file of files) {
      const hits = await scanFile(file);
      for (const hit of hits) {
        if (allowed.has(`${hit.file}:${hit.line.toString()}`)) continue;
        violations.push(hit);
      }
    }
  }

  return { roots: [...ROOTS], scannedFiles, violations };
}

function printHumanReport(report: MoneyAuditReport): void {
  if (report.violations.length === 0) {
    console.log(
      `Money audit clean -- scanned ${report.scannedFiles.toString()} file(s) across ` +
        `${report.roots.join(', ')}, no decimal.js escapes.`,
    );
    return;
  }

  console.error(
    `\nMoney audit failed -- ${report.violations.length.toString()} numeric-coercion ` +
      `violation(s) in the decimal.js money core:\n`,
  );
  for (const v of report.violations) {
    console.error(`  ${v.file}:${v.line.toString()}:${v.column.toString()}  [${v.pattern}]`);
    console.error(`    ${v.snippet}`);
    console.error(`    ${v.message}`);
    console.error('');
  }
  console.error(
    'Keep money in Decimal end to end. If a hit is a genuine non-money coercion ' +
      '(integer count, index), add an audited exemption in scripts/audit-money.config.ts.',
  );
}

async function main(): Promise<void> {
  const wantJson = process.argv.includes('--json');

  let report: MoneyAuditReport;
  try {
    report = await run();
  } catch (err) {
    console.error(`audit-money: ${String(err)}`);
    process.exit(2);
  }

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  process.exit(report.violations.length > 0 ? 1 : 0);
}

await main();
