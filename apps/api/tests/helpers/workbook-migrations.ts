// Reads the hand-written SQL of the two migrations that backfill `source_format_id` on
// the six campaign parent tables: `add_workbook_source_format` and
// `limit_workbook_names`. Neither the drift check (empty tables) nor the test database
// executes a backfill, so source-format-backfill.test.ts pins the SQL text and
// registry.test.ts ties each backfilled id to its adapter's format.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'packages/db/prisma/migrations');

/** The folder name of each migration that backfills `source_format_id`. */
export const SOURCE_FORMAT_MIGRATIONS = {
  addColumn: /^\d+_add_workbook_source_format$/,
  limitNames: /^\d+_limit_workbook_names$/,
} as const;

const BACKFILL_PATTERN = /UPDATE "([a-z_]+)" SET "source_format_id" = '([^']*)'([^;]*);/g;
const SQL_LINE_COMMENT_PATTERN = /--[^\n]*/g;
const SQL_BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

/** One `UPDATE <table> SET source_format_id = '<id>' <tail>;` of a migration. */
export interface SourceFormatBackfill {
  readonly table: string;
  readonly id: string;
  /** Everything between the quoted id and the semicolon: the WHERE clause. */
  readonly tail: string;
}

/** The SQL of the one migration whose folder matches `folder`, without its comments. */
export function readMigrationSql(folder: RegExp): string {
  const folders = readdirSync(MIGRATIONS_DIR).filter((name) => folder.test(name));
  const [only] = folders;
  if (folders.length !== 1 || only === undefined) {
    throw new Error(
      `Expected one migration folder matching ${String(folder)}, found ${folders.length}`,
    );
  }
  const sql = readFileSync(resolve(MIGRATIONS_DIR, only, 'migration.sql'), 'utf8');
  return sql.replace(SQL_BLOCK_COMMENT_PATTERN, '').replace(SQL_LINE_COMMENT_PATTERN, '');
}

/** Every `source_format_id` backfill of `sql`, in file order. */
export function sourceFormatBackfills(sql: string): SourceFormatBackfill[] {
  return [...sql.matchAll(BACKFILL_PATTERN)].map((match) => ({
    table: match[1] ?? '',
    id: match[2] ?? '',
    tail: match[3] ?? '',
  }));
}
