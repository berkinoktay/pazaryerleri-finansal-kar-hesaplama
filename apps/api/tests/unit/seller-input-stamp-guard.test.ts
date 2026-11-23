// Guard (same-day edit window, plan P1-01): the database writes the two
// seller-input stamps. `product_variant_cost_profiles.attached_at` and
// `cost_profile_versions.effective_from` default to the writer transaction's
// start instant (a UTC wall clock), so every stamp of one transaction is the
// same instant and lines up with the trigger-written removal and desi logs. A
// production writer that passed its own `attachedAt` / `effectiveFrom` would
// put a process-clock value next to database-clock values and could move an
// edit across an order's business-day end.
//
// This test reads every production source file of the backend, the worker and
// the shared packages and fails on any occurrence of `attachedAt:` or
// `effectiveFrom:` that is not one of the known read shapes (a filter, a sort
// or select flag, a type member, a Zod schema, or a copy of a value just read
// from a link or a version). Test files, test helpers and generated code are
// not scanned: factories may pass an explicit stamp to backdate a fixture.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../../../..');

const APP_SOURCE_ROOTS = ['apps/api/src', 'apps/sync-worker/src'] as const;
const PACKAGES_DIR = 'packages';
const EXCLUDED_DIRS = new Set(['__tests__', 'generated', 'node_modules']);

// One occurrence of a stamp key used as an object key or a type member.
const STAMP_KEY_RE = /\b(attachedAt|effectiveFrom)\??\s*:\s*/g;

// What may follow the key when the line only reads a stamp.
const READ_VALUE_SHAPES: readonly RegExp[] = [
  // where-style filter: `effectiveFrom: { lte: at }`
  /^\{\s*(lte|lt|gte|gt|equals|not|in)\b/,
  // select / orderBy flag: `attachedAt: true`, `{ effectiveFrom: 'desc' }`
  /^(true|false)\b/,
  /^['"](asc|desc)['"]/,
  // a value just read from a link or a version, copied into a DTO or row shape
  /^(link|version)\.(attachedAt|effectiveFrom)\b/,
  // a type member: `readonly attachedAt: Date;`
  /^Date\s*[;,]?\s*$/,
  // a Zod response schema field
  /^z\./,
];

// What may precede the key: an equality filter inside a `where` object.
const READ_PREFIX_SHAPES: readonly RegExp[] = [/\bwhere\s*:\s*\{\s*$/];

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** True when the line writes (or may write) one of the two stamps. */
function writesStamp(line: string): boolean {
  if (isCommentLine(line)) return false;
  for (const match of line.matchAll(STAMP_KEY_RE)) {
    const start = match.index;
    const before = line.slice(0, start);
    const value = line.slice(start + match[0].length);
    const isRead =
      READ_VALUE_SHAPES.some((shape) => shape.test(value)) ||
      READ_PREFIX_SHAPES.some((shape) => shape.test(before));
    if (!isRead) return true;
  }
  return false;
}

function countStampKeys(line: string): number {
  if (isCommentLine(line)) return 0;
  return [...line.matchAll(STAMP_KEY_RE)].length;
}

function collectSourceFiles(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, files);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
}

function sourceRoots(): string[] {
  const roots = APP_SOURCE_ROOTS.map((root) => path.join(REPO_ROOT, root));
  const packagesDir = path.join(REPO_ROOT, PACKAGES_DIR);
  for (const name of readdirSync(packagesDir)) {
    const src = path.join(packagesDir, name, 'src');
    if (existsSync(src)) roots.push(src);
  }
  return roots;
}

interface StampOccurrence {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function scanSources(): { files: number; keys: Map<string, number>; writes: StampOccurrence[] } {
  const files: string[] = [];
  for (const root of sourceRoots()) collectSourceFiles(root, files);

  const keys = new Map<string, number>();
  const writes: StampOccurrence[] = [];
  for (const file of files) {
    const relative = path.relative(REPO_ROOT, file);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        const count = countStampKeys(text);
        if (count === 0) return;
        keys.set(relative, (keys.get(relative) ?? 0) + count);
        if (writesStamp(text)) writes.push({ file: relative, line: index + 1, text: text.trim() });
      });
  }
  return { files: files.length, keys, writes };
}

describe('seller-input stamps are written by the database only', () => {
  it('the matcher flags a stamp write and passes the read shapes', () => {
    // Positive controls: writes of either stamp are caught.
    expect(writesStamp('      attachedAt: new Date(),')).toBe(true);
    expect(writesStamp('  effectiveFrom: someInstant,')).toBe(true);
    expect(writesStamp('data: { profileId, attachedAt: now },')).toBe(true);
    expect(writesStamp('    effectiveFrom:')).toBe(true);
    // Read shapes found in the production sources today.
    expect(writesStamp("    orderBy: [{ attachedAt: 'desc' }],")).toBe(false);
    expect(writesStamp('            where: { effectiveFrom: { lte: at } },')).toBe(false);
    expect(writesStamp('    select: { effectiveFrom: true, version: true },')).toBe(false);
    expect(writesStamp('  readonly effectiveFrom: Date;')).toBe(false);
    expect(writesStamp('  attachedAt: Date;')).toBe(false);
    expect(writesStamp('    attachedAt: link.attachedAt.toISOString(),')).toBe(false);
    expect(writesStamp('            effectiveFrom: version.effectiveFrom,')).toBe(false);
    expect(writesStamp('    attachedAt: z.string().datetime(),')).toBe(false);
    expect(writesStamp('    where: { effectiveFrom: CANONICAL_START },')).toBe(false);
    expect(writesStamp('  // attachedAt: new Date() in a comment')).toBe(false);
  });

  it('no production source passes attachedAt or effectiveFrom on a write', () => {
    const { files, keys, writes } = scanSources();

    // Positive control: the scan reached the cost writers and their readers (the one
    // day-end loader every seller-input gate reads).
    expect(files).toBeGreaterThan(0);
    const costService = path.join('apps', 'api', 'src', 'services', 'cost-profile.service.ts');
    const dayEndLoader = path.join(
      'packages',
      'profit',
      'src',
      'persistence',
      'seller-inputs-at.ts',
    );
    expect(keys.get(costService) ?? 0).toBeGreaterThan(0);
    expect(keys.get(dayEndLoader) ?? 0).toBeGreaterThan(0);

    expect(writes).toEqual([]);
  });
});
