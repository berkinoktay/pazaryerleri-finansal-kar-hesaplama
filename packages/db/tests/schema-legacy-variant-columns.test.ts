// Contract step of the product variant status migration (C4). The legacy
// status flags, the dead cost and fast-delivery columns, products.approved and
// three unused indexes are gone; the status columns that replaced the flags and
// the columns and indexes the products list still reads stay. Runs against the
// isolated test DB: vitest.config.ts remaps DATABASE_URL before this file loads.

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DROPPED_VARIANT_COLUMNS = [
  'archived',
  'blacklisted',
  'cost_price',
  'fast_delivery_options',
  'is_rush_delivery',
  'location_based_delivery',
  'locked',
  'on_sale',
] as const;

// Sorted by name: the helpers below return rows ORDER BY name.
const KEPT_VARIANT_COLUMNS = [
  'delisted_at',
  'delivery_duration',
  'status',
  'status_reason',
  'stock_code',
] as const;

const DROPPED_INDEXES = [
  'product_variants_store_id_on_sale_archived_idx',
  'product_variants_store_id_stock_code_idx',
  'products_store_id_product_main_id_idx',
] as const;

const KEPT_INDEXES = [
  'product_variants_store_id_barcode_idx',
  'product_variants_store_id_delisted_at_idx',
  'product_variants_store_id_status_idx',
] as const;

const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

async function existingColumns(table: string, names: readonly string[]): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])
     ORDER BY column_name`,
    [table, names],
  );
  return rows.map((row) => row.column_name);
}

async function existingIndexes(names: readonly string[]): Promise<string[]> {
  const { rows } = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ANY($1::text[])
     ORDER BY indexname`,
    [names],
  );
  return rows.map((row) => row.indexname);
}

describe('product catalog schema after dropping the legacy variant columns', () => {
  it('drops the legacy flag, cost and fast-delivery columns from product_variants', async () => {
    expect(await existingColumns('product_variants', DROPPED_VARIANT_COLUMNS)).toEqual([]);
  });

  it('keeps the status columns and the columns the products list still reads', async () => {
    expect(await existingColumns('product_variants', KEPT_VARIANT_COLUMNS)).toEqual([
      ...KEPT_VARIANT_COLUMNS,
    ]);
  });

  it('drops products.approved but keeps products.product_main_id', async () => {
    expect(await existingColumns('products', ['approved'])).toEqual([]);
    expect(await existingColumns('products', ['product_main_id'])).toEqual(['product_main_id']);
  });

  it('drops the legacy indexes and keeps the barcode, delist and status ones', async () => {
    expect(await existingIndexes(DROPPED_INDEXES)).toEqual([]);
    expect(await existingIndexes(KEPT_INDEXES)).toEqual([...KEPT_INDEXES]);
  });
});
