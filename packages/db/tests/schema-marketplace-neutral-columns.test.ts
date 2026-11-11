// The shared order and claim tables carry marketplace-neutral column names:
// orders.micro became is_export_sale and the two Trendyol claim ids became
// marketplace_claim_id / marketplace_claim_item_id (RENAMEs, so existing rows
// survive). The two unique indexes moved to names that match the new columns,
// and order_items regained an organization_id-leading index. Runs against the
// isolated test DB: vitest.config.ts remaps DATABASE_URL before this file loads.

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface RenamedColumn {
  table: string;
  oldColumn: string;
  newColumn: string;
}

const RENAMED_COLUMNS: readonly RenamedColumn[] = [
  { table: 'orders', oldColumn: 'micro', newColumn: 'is_export_sale' },
  { table: 'order_claims', oldColumn: 'trendyol_claim_id', newColumn: 'marketplace_claim_id' },
  {
    table: 'order_claim_items',
    oldColumn: 'trendyol_claim_item_id',
    newColumn: 'marketplace_claim_item_id',
  },
];

interface RenamedIndex {
  table: string;
  oldName: string;
  newName: string;
  columns: string;
}

const RENAMED_UNIQUE_INDEXES: readonly RenamedIndex[] = [
  {
    table: 'order_claims',
    oldName: 'order_claims_order_id_trendyol_claim_id_key',
    newName: 'order_claims_order_id_marketplace_claim_id_key',
    columns: '(order_id, marketplace_claim_id)',
  },
  {
    table: 'order_claim_items',
    oldName: 'order_claim_items_claim_id_trendyol_claim_item_id_key',
    newName: 'order_claim_items_claim_id_marketplace_claim_item_id_key',
    columns: '(claim_id, marketplace_claim_item_id)',
  },
];

const ORDER_ITEMS_ORG_INDEX = 'order_items_organization_id_idx';

interface ColumnShape {
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

async function columnShape(table: string, column: string): Promise<ColumnShape | null> {
  const { rows } = await client.query<ColumnShape>(
    `SELECT data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows[0] ?? null;
}

async function indexDefinition(table: string, name: string): Promise<string | null> {
  const { rows } = await client.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2`,
    [table, name],
  );
  return rows[0]?.indexdef ?? null;
}

describe('marketplace-neutral column names on the shared order and claim tables', () => {
  for (const { table, oldColumn, newColumn } of RENAMED_COLUMNS) {
    it(`${table} has ${newColumn} and no longer has ${oldColumn}`, async () => {
      expect(await columnShape(table, newColumn)).not.toBeNull();
      expect(await columnShape(table, oldColumn)).toBeNull();
    });
  }

  it('keeps is_export_sale as a NOT NULL boolean defaulting to false', async () => {
    expect(await columnShape('orders', 'is_export_sale')).toEqual({
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'false',
    });
  });

  it('keeps both claim ids as NOT NULL text', async () => {
    const expected: ColumnShape = { data_type: 'text', is_nullable: 'NO', column_default: null };
    expect(await columnShape('order_claims', 'marketplace_claim_id')).toEqual(expected);
    expect(await columnShape('order_claim_items', 'marketplace_claim_item_id')).toEqual(expected);
  });

  for (const { table, oldName, newName, columns } of RENAMED_UNIQUE_INDEXES) {
    it(`renames the ${table} unique index to ${newName}`, async () => {
      const definition = await indexDefinition(table, newName);
      expect(definition).not.toBeNull();
      expect(definition).toContain('CREATE UNIQUE INDEX');
      expect(definition).toContain(columns);
      expect(await indexDefinition(table, oldName)).toBeNull();
    });
  }

  it('indexes order_items by organization_id', async () => {
    const definition = await indexDefinition('order_items', ORDER_ITEMS_ORG_INDEX);
    expect(definition).not.toBeNull();
    expect(definition).toContain('(organization_id)');
  });
});
