import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { UPLOAD_NAME_MAX_LENGTH, WORKBOOK_PAGES, type WorkbookPage } from '@pazarsync/utils';
import { describe, expect, it } from 'vitest';

import {
  readMigrationSql,
  SOURCE_FORMAT_MIGRATIONS,
  sourceFormatBackfills,
} from '../../helpers/workbook-migrations';

/**
 * The `add_workbook_source_format` migration backfills `source_format_id` on the
 * six campaign parent tables with hand-written ids, and `limit_workbook_names` does it
 * again for the rows the legacy import stored between the two deploys, behind a guard
 * that stops the migration on a name it would have to cut. Neither the drift check
 * (empty tables) nor the test database (`prisma db push`) executes that SQL, so this
 * test pins the text itself: one UPDATE per parent table, each id built from
 * `WORKBOOK_PAGES`, each scoped to rows that hold a stored file.
 */

const REPO_ROOT = resolve(__dirname, '../../../../..');
const RLS_POLICIES_FILE = resolve(REPO_ROOT, 'supabase/sql/rls-policies.sql');

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
const BACKFILL_WHERE_PATTERN = /^\s*WHERE "source_file" IS NOT NULL\s*$/;
const REBACKFILL_WHERE_PATTERN =
  /^\s*WHERE "source_file" IS NOT NULL AND "source_format_id" IS NULL\s*$/;
const UPDATE_KEYWORD_PATTERN = /\bUPDATE\b/gi;
const ALTER_TABLE_PATTERN = /\bALTER TABLE\b/;
const FOREACH_TABLE_LIST_PATTERN =
  /FOREACH _table IN ARRAY ARRAY\[([^\]]*)\]([\s\S]*?)\nEND\n\$\$;/g;
const QUOTED_TABLE_PATTERN = /'([a-z_]+)'/g;
const SOURCE_FILE_COLUMN_CHECK = "column_name = 'source_file'";
const RAISE_EXCEPTION = 'RAISE EXCEPTION';

interface TableListBlock {
  readonly tables: string[];
  readonly body: string;
  readonly index: number;
}

/** Every `FOREACH _table IN ARRAY ARRAY[...] ... END $$;` block of `sql`. */
function tableListBlocks(sql: string): TableListBlock[] {
  return [...sql.matchAll(FOREACH_TABLE_LIST_PATTERN)].map((match) => ({
    tables: [...(match[1] ?? '').matchAll(QUOTED_TABLE_PATTERN)].map((table) => table[1] ?? ''),
    body: match[2] ?? '',
    index: match.index,
  }));
}

/** The table list the `source_file` column-privilege block of rls-policies.sql walks. */
function sourceFileGrantTables(): string[] {
  const sql = readFileSync(RLS_POLICIES_FILE, 'utf8');
  const blocks = tableListBlocks(sql).filter((block) =>
    block.body.includes(SOURCE_FILE_COLUMN_CHECK),
  );
  expect(blocks).toHaveLength(1);
  const [block] = blocks;
  if (block === undefined) throw new Error('source_file privilege block not found');
  return block.tables;
}

function expectedSourceFormatId(page: WorkbookPage): string {
  return `${SOURCE_FORMAT_PLATFORM}:${page}:${SOURCE_FORMAT_VERSION}`;
}

describe('add_workbook_source_format migration backfill', () => {
  const readSql = (): string => readMigrationSql(SOURCE_FORMAT_MIGRATIONS.addColumn);

  it('covers exactly the parent tables of the source_file privilege block', () => {
    expect(Object.keys(PAGE_BY_TABLE).sort()).toEqual(sourceFileGrantTables().sort());
    expect(Object.values(PAGE_BY_TABLE).sort()).toEqual(Object.values(WORKBOOK_PAGES).sort());
  });

  it('adds a nullable VARCHAR(64) source_format_id to each parent table once', () => {
    const added = [...readSql().matchAll(ADD_COLUMN_PATTERN)].map((match) => ({
      table: match[1] ?? '',
      length: Number(match[2]),
    }));

    expect(added.map((column) => column.table).sort()).toEqual(Object.keys(PAGE_BY_TABLE).sort());
    for (const column of added) {
      expect(column.length).toBe(SOURCE_FORMAT_ID_MAX_LENGTH);
    }
  });

  it('holds exactly six backfills, one per parent table, and no other UPDATE', () => {
    const sql = readSql();
    const pairs = sourceFormatBackfills(sql);

    expect(pairs).toHaveLength(Object.keys(PAGE_BY_TABLE).length);
    expect(pairs.map((pair) => pair.table).sort()).toEqual(Object.keys(PAGE_BY_TABLE).sort());
    expect([...sql.matchAll(UPDATE_KEYWORD_PATTERN)]).toHaveLength(pairs.length);
  });

  it.each(Object.entries(PAGE_BY_TABLE))(
    '%s is backfilled with the TRENDYOL id of its page, only where a file is stored',
    (table, page) => {
      const pair = sourceFormatBackfills(readSql()).find((candidate) => candidate.table === table);
      if (pair === undefined) throw new Error(`no backfill for ${table}`);

      expect(pair.id).toBe(expectedSourceFormatId(page));
      expect(pair.id.length).toBeLessThanOrEqual(SOURCE_FORMAT_ID_MAX_LENGTH);
      expect(pair.tail).toMatch(BACKFILL_WHERE_PATTERN);
    },
  );
});

describe('limit_workbook_names migration guard and backfill', () => {
  const readSql = (): string => readMigrationSql(SOURCE_FORMAT_MIGRATIONS.limitNames);

  it('holds exactly six backfills, one per parent table, and no other UPDATE', () => {
    const sql = readSql();
    const pairs = sourceFormatBackfills(sql);

    expect(pairs).toHaveLength(Object.keys(PAGE_BY_TABLE).length);
    expect(pairs.map((pair) => pair.table).sort()).toEqual(Object.keys(PAGE_BY_TABLE).sort());
    expect([...sql.matchAll(UPDATE_KEYWORD_PATTERN)]).toHaveLength(pairs.length);
  });

  it.each(Object.entries(PAGE_BY_TABLE))(
    '%s is backfilled again with the TRENDYOL id of its page, only where a stored file has none',
    (table, page) => {
      const pair = sourceFormatBackfills(readSql()).find((candidate) => candidate.table === table);
      if (pair === undefined) throw new Error(`no backfill for ${table}`);

      expect(pair.id).toBe(expectedSourceFormatId(page));
      expect(pair.id.length).toBeLessThanOrEqual(SOURCE_FORMAT_ID_MAX_LENGTH);
      expect(pair.tail).toMatch(REBACKFILL_WHERE_PATTERN);
    },
  );

  it('stops on a name or file name longer than the limit in any of the six tables', () => {
    const blocks = tableListBlocks(readSql());

    expect(blocks).toHaveLength(1);
    const [guard] = blocks;
    if (guard === undefined) throw new Error('name length guard not found');
    expect([...guard.tables].sort()).toEqual(Object.keys(PAGE_BY_TABLE).sort());
    expect(guard.body).toContain(`char_length("name") > ${UPLOAD_NAME_MAX_LENGTH}`);
    expect(guard.body).toContain(`char_length("source_filename") > ${UPLOAD_NAME_MAX_LENGTH}`);
    expect(guard.body).toContain(RAISE_EXCEPTION);
  });

  it('runs the guard and the backfills before the first ALTER TABLE', () => {
    const sql = readSql();
    const firstAlter = sql.search(ALTER_TABLE_PATTERN);
    const lastUpdate = Math.max(
      ...[...sql.matchAll(UPDATE_KEYWORD_PATTERN)].map((match) => match.index),
    );
    const [guard] = tableListBlocks(sql);

    expect(firstAlter).toBeGreaterThan(-1);
    expect(guard?.index).toBeLessThan(firstAlter);
    expect(lastUpdate).toBeLessThan(firstAlter);
  });
});
