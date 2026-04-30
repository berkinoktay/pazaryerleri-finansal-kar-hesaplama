#!/usr/bin/env tsx
/**
 * Component manifest emitter — Phase 0 skeleton.
 *
 * Walks `apps/web/src/components/ui` and `apps/web/src/components/patterns`,
 * extracts a small, AI-consumable index of every primitive and composite,
 * and writes it to `apps/web/components.manifest.json`. Future Claude
 * sessions read the manifest directly (no server, no MCP needed) to
 * answer "what components exist" / "which one fits use case X".
 *
 * Skeleton scope (Phase 0):
 *   - File walk + categorization (ui → atom, patterns → molecule)
 *   - PascalCase component name from filename
 *   - `@useWhen <hint>` JSDoc tag parsed from each file (optional)
 *   - `@status experimental|deprecated` JSDoc tag (defaults to `stable`)
 *   - Deterministic output (sorted by name) so the manifest is diffable
 *
 * Future work (out of Phase 0): prop signatures via react-docgen-typescript,
 * showcase-route example links, per-component test coverage.
 *
 * Usage:
 *   pnpm emit:components-manifest          # write manifest
 *   pnpm emit:components-manifest --check  # exit 1 if committed manifest is stale
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const WEB_ROOT = resolve(REPO_ROOT, 'apps/web');
const OUT_FILE = resolve(WEB_ROOT, 'components.manifest.json');

type Category = 'atom' | 'molecule' | 'organism';
type Status = 'stable' | 'experimental' | 'deprecated';

interface ManifestEntry {
  name: string;
  path: string;
  category: Category;
  status: Status;
  useWhen?: string;
}

interface Manifest {
  version: 1;
  count: number;
  components: ManifestEntry[];
}

interface SourceDir {
  dir: string;
  category: Category;
}

const SOURCES: SourceDir[] = [
  { dir: resolve(WEB_ROOT, 'src/components/ui'), category: 'atom' },
  { dir: resolve(WEB_ROOT, 'src/components/patterns'), category: 'molecule' },
];

async function listTsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) continue;
    if (!/\.(tsx?)$/.test(entry)) continue;
    out.push(full);
  }
  return out.sort();
}

function pascalize(fileName: string): string {
  return fileName
    .replace(/\.tsx?$/, '')
    .split('-')
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : ''))
    .join('');
}

function extractName(source: string, fileName: string): string {
  const pascal = pascalize(fileName);
  // Prefer the export that matches the file name (PascalCase).
  const named = new RegExp(`export\\s+(?:default\\s+)?(?:function|const|class)\\s+${pascal}\\b`);
  if (named.test(source)) return pascal;
  // Fallback: first exported function / const / class.
  const fallback = source.match(
    /export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/,
  );
  return fallback?.[1] ?? pascal;
}

function extractUseWhen(source: string): string | undefined {
  // Match `@useWhen <text>` until end of line / end of JSDoc.
  const match = source.match(/@useWhen\s+([^\n*]+?)(?:\s*\*\/|\s*\n)/);
  return match?.[1]?.trim();
}

function extractStatus(source: string): Status {
  if (/@status\s+experimental\b/.test(source)) return 'experimental';
  if (/@status\s+deprecated\b/.test(source)) return 'deprecated';
  return 'stable';
}

async function buildManifest(): Promise<Manifest> {
  const components: ManifestEntry[] = [];
  for (const { dir, category } of SOURCES) {
    const files = await listTsxFiles(dir);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const fileName = file.split('/').pop() ?? '';
      const name = extractName(source, fileName);
      const useWhen = extractUseWhen(source);
      const status = extractStatus(source);
      components.push({
        name,
        path: relative(REPO_ROOT, file),
        category,
        status,
        ...(useWhen !== undefined ? { useWhen } : {}),
      });
    }
  }
  components.sort((a, b) => a.name.localeCompare(b.name));
  return {
    version: 1,
    count: components.length,
    components,
  };
}

function serialize(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

async function main(): Promise<void> {
  const isCheck = process.argv.includes('--check');
  const manifest = await buildManifest();
  const expected = serialize(manifest);

  if (isCheck) {
    let existing: string;
    try {
      existing = await readFile(OUT_FILE, 'utf8');
    } catch {
      console.error(
        `[emit-component-manifest] ${relative(REPO_ROOT, OUT_FILE)} is missing. ` +
          `Run \`pnpm emit:components-manifest\` and commit the result.`,
      );
      process.exit(1);
    }
    if (existing !== expected) {
      console.error(
        `[emit-component-manifest] ${relative(REPO_ROOT, OUT_FILE)} is stale. ` +
          `Run \`pnpm emit:components-manifest\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`[emit-component-manifest] manifest is up to date (${manifest.count} components)`);
    return;
  }

  await writeFile(OUT_FILE, expected);
  console.log(
    `[emit-component-manifest] wrote ${manifest.count} components to ` +
      `${relative(REPO_ROOT, OUT_FILE)}`,
  );
}

main().catch((err) => {
  console.error('[emit-component-manifest] fatal:', err);
  process.exit(2);
});
