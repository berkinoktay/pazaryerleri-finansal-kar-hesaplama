import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';
import { describe, expect, it } from 'vitest';

/**
 * The `add_workbook_source_format` migration backfills `source_format_id` on the
 * six campaign parent tables with hand-written ids. Neither the drift check
 * (empty tables) nor the test database (`prisma db push`) executes that backfill,
 * so this test pins the SQL text itself: one UPDATE per parent table, each id
 * built from `WORKBOOK_PAGES`, each scoped to rows that hold a stored file.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'packages/db/prisma/migrations');
const RLS_POLICIES_FILE = resolve(REPO_ROOT, 'supabase/sql/rls-policies.sql');

const MIGRATION_DIR_PATTERN = /^\d+_add_workbook_source_format$/;
const SOURCE_FORMAT_PLATFORM = 'TRENDYOL';
const SOURCE_FORMAT_VERSION = 'v1';
/** Mirrors `@db.VarChar(64)` on `sourceFormatId` in schema.prisma. */
const SOURCE_FORMAT_ID_MAX_LENGTH = 64;

/** Every campaign parent table that stores a workbook, keyed by its SQL name. */
const PAGE_BY_TABLE: Readonly<Record<string, WorkbookPage>> = {
  commission_tariffs: WORKBOOK_PAGES.COMMISSION_TARIFF,
  plus_commission_tariffs: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
  advantage_tariffs: WORKBOOK_PAGES.ADVANTAGE_TARIFF,
  flash_product_lists: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
  discount_lists: WORKBOOK_PAGES.DISCOUNT_LIST,
  marketplace_campaign_lists: WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
};

const ADD_COLUMN_PATTERN =
  /ALTER TABLE "([a-z_]+)" ADD COLUMN\s+"source_format_id" VARCHAR\((\d+)\);/g;
const BACKFILL_PATTERN = /UPDATE "([a-z_]+)" SET "source_format_id" = '([^']*)'([^;]*);/g;
const BACKFILL_WHERE_PATTERN = /^\s*WHERE "source_file" IS NOT NULL\s*$/;
const UPDATE_KEYWORD_PATTERN = /\bUPDATE\b/gi;
const SQL_LINE_COMMENT_PATTERN = /--[^\n]*/g;
const SQL_BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const FOREACH_TABLE_LIST_PATTERN =
  /FOREACH _table IN ARRAY ARRAY\[([^\]]*)\]([\s\S]*?)\nEND\n\$\$;/g;
const QUOTED_TABLE_PATTERN = /'([a-z_]+)'/g;
const SOURCE_FILE_COLUMN_CHECK = "column_name = 'source_file'";

interface Backfill {
  readonly table: string;
  readonly id: string;
  readonly tail: string;
}

function readMigrationSql(): string {
  const folders = readdirSync(MIGRATIONS_DIR).filter((name) => MIGRATION_DIR_PATTERN.test(name));
  expect(folders).toHaveLength(1);
  const [folder] = folders;
  if (folder === undefined) throw new Error('add_workbook_source_format migration not found');
  const sql = readFileSync(resolve(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8');
  return sql.replace(SQL_BLOCK_COMMENT_PATTERN, '').replace(SQL_LINE_COMMENT_PATTERN, '');
}

function backfills(sql: string): Backfill[] {
  return [...sql.matchAll(BACKFILL_PATTERN)].map((match) => ({
    table: match[1] ?? '',
    id: match[2] ?? '',
    tail: match[3] ?? '',
  }));
}

/** The table list the `source_file` column-privilege block of rls-policies.sql walks. */
function sourceFileGrantTables(): string[] {
  const sql = readFileSync(RLS_POLICIES_FILE, 'utf8');
  const lists = [...sql.matchAll(FOREACH_TABLE_LIST_PATTERN)]
    .filter((match) => (match[2] ?? '').includes(SOURCE_FILE_COLUMN_CHECK))
    .map((match) => match[1] ?? '');
  expect(lists).toHaveLength(1);
  const [list] = lists;
  if (list === undefined) throw new Error('source_file privilege block not found');
  return [...list.matchAll(QUOTED_TABLE_PATTERN)].map((match) => match[1] ?? '');
}

function expectedSourceFormatId(page: WorkbookPage): string {
  return `${SOURCE_FORMAT_PLATFORM}:${page}:${SOURCE_FORMAT_VERSION}`;
}

describe('add_workbook_source_format migration backfill', () => {
  it('covers exactly the parent tables of the source_file privilege block', () => {
    expect(Object.keys(PAGE_BY_TABLE).sort()).toEqual(sourceFileGrantTables().sort());
    expect(Object.values(PAGE_BY_TABLE).sort()).toEqual(Object.values(WORKBOOK_PAGES).sort());
  });

  it('adds a nullable VARCHAR(64) source_format_id to each parent table once', () => {
    const added = [...readMigrationSql().matchAll(ADD_COLUMN_PATTERN)].map((match) => ({
      table: match[1] ?? '',
      length: Number(match[2]),
    }));

    expect(added.map((column) => column.table).sort()).toEqual(Object.keys(PAGE_BY_TABLE).sort());
    for (const column of added) {
      expect(column.length).toBe(SOURCE_FORMAT_ID_MAX_LENGTH);
    }
  });

  it('holds exactly six backfills, one per parent table, and no other UPDATE', () => {
    const sql = readMigrationSql();
    const pairs = backfills(sql);

    expect(pairs).toHaveLength(Object.keys(PAGE_BY_TABLE).length);
    expect(pairs.map((pair) => pair.table).sort()).toEqual(Object.keys(PAGE_BY_TABLE).sort());
    expect([...sql.matchAll(UPDATE_KEYWORD_PATTERN)]).toHaveLength(pairs.length);
  });

  it.each(Object.entries(PAGE_BY_TABLE))(
    '%s is backfilled with the TRENDYOL id of its page, only where a file is stored',
    (table, page) => {
      const pair = backfills(readMigrationSql()).find((candidate) => candidate.table === table);
      if (pair === undefined) throw new Error(`no backfill for ${table}`);

      expect(pair.id).toBe(expectedSourceFormatId(page));
      expect(pair.id.length).toBeLessThanOrEqual(SOURCE_FORMAT_ID_MAX_LENGTH);
      expect(pair.tail).toMatch(BACKFILL_WHERE_PATTERN);
    },
  );
});
