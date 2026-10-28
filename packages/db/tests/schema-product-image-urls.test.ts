// Product images live on the product row as an ordered url list
// (products.image_urls, Trendyol order, first entry = primary image). The old
// product_images child table and its (product_id, position) index are gone.
// Runs against the isolated test DB: vitest.config.ts remaps DATABASE_URL
// before this file loads.

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DROPPED_TABLE = 'product_images';
const DROPPED_INDEX = 'product_images_product_id_position_idx';

const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

async function tableExists(table: string): Promise<boolean> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function columnDataType(table: string, column: string): Promise<string | null> {
  const { rows } = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows[0]?.data_type ?? null;
}

async function indexExists(name: string): Promise<boolean> {
  const { rows } = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [name],
  );
  return rows.length > 0;
}

describe('product catalog schema after moving images onto the product row', () => {
  it('drops the product_images table', async () => {
    expect(await tableExists(DROPPED_TABLE)).toBe(false);
  });

  it('adds products.image_urls as an array column', async () => {
    expect(await columnDataType('products', 'image_urls')).toBe('ARRAY');
  });

  it('drops the product_images (product_id, position) index', async () => {
    expect(await indexExists(DROPPED_INDEX)).toBe(false);
  });
});
