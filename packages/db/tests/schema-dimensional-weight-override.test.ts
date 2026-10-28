// The seller's desi override is named for what it is: product_variants
// .dimensional_weight became dimensional_weight_override (a RENAME, so existing
// overrides survive), next to the marketplace's synced_dimensional_weight. The
// non-negative CHECK guarding both columns moved to a name that matches the new
// column. Runs against the isolated test DB: vitest.config.ts remaps
// DATABASE_URL before this file loads.

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TABLE = 'product_variants';
const OLD_COLUMN = 'dimensional_weight';
const OVERRIDE_COLUMN = 'dimensional_weight_override';
const SYNCED_COLUMN = 'synced_dimensional_weight';
const OLD_CONSTRAINT = 'product_variants_dimensional_weight_nonneg_check';
const NEW_CONSTRAINT = 'product_variants_dimensional_weight_override_nonneg_check';

interface ColumnShape {
  data_type: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
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

async function columnShape(column: string): Promise<ColumnShape | null> {
  const { rows } = await client.query<ColumnShape>(
    `SELECT data_type, numeric_precision, numeric_scale, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [TABLE, column],
  );
  return rows[0] ?? null;
}

async function checkConstraintDefinition(name: string): Promise<string | null> {
  const { rows } = await client.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = $1 AND c.contype = 'c' AND c.conname = $2`,
    [TABLE, name],
  );
  return rows[0]?.definition ?? null;
}

describe('product_variants desi columns after the override rename', () => {
  it('no longer has the dimensional_weight column', async () => {
    expect(await columnShape(OLD_COLUMN)).toBeNull();
  });

  it('has dimensional_weight_override as a nullable numeric(6,2) with no default', async () => {
    expect(await columnShape(OVERRIDE_COLUMN)).toEqual({
      data_type: 'numeric',
      numeric_precision: 6,
      numeric_scale: 2,
      is_nullable: 'YES',
      column_default: null,
    });
  });

  it('keeps synced_dimensional_weight as NOT NULL numeric(6,2) with default 0', async () => {
    expect(await columnShape(SYNCED_COLUMN)).toEqual({
      data_type: 'numeric',
      numeric_precision: 6,
      numeric_scale: 2,
      is_nullable: 'NO',
      column_default: '0',
    });
  });

  it('guards both columns with the renamed non-negative CHECK', async () => {
    const definition = await checkConstraintDefinition(NEW_CONSTRAINT);
    expect(definition).not.toBeNull();
    expect(definition).toContain('synced_dimensional_weight >= ');
    expect(definition).toContain('dimensional_weight_override IS NULL');
    expect(definition).toContain('dimensional_weight_override >= ');
  });

  it('drops the CHECK under its old name', async () => {
    expect(await checkConstraintDefinition(OLD_CONSTRAINT)).toBeNull();
  });
});
