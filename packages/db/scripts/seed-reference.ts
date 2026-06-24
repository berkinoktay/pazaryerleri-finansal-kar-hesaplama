// Reference-data seed. Run with: `pnpm db:seed-reference`.
//
// "Reference data" = rows whose existence the app reads but never writes —
// platform-scoped marketplace tariffs, fee definitions, shipping baremler.
// They are NOT per-tenant; the same TRENDYOL commission row services every
// seller. The Komisyon Oranları page reads them straight off the DB, so an
// empty table renders as "Komisyon tarifesi henüz yüklenmedi" no matter
// which store is active.
//
// Kept separate from `prisma/seed.ts` on purpose:
//
//   - `pnpm db:seed --with-sample` hydrates DEV fixture data (users, orgs,
//     stores, products, orders) and is opt-in; default is clean baseline.
//   - `pnpm db:seed-reference` hydrates reference data and is always safe
//     to re-run. No users / orgs / stores touched, so it never wipes a
//     working dev tenant.
//
// Idempotent: each loader does `delete (platform, ruleKind)` → bulk insert,
// so re-running with newer snapshots replaces the bucket cleanly.
//
// Source files live under `tmp/trendyol/reference/` (gitignored — see
// `prisma/seed.ts` header for why we don't commit ~38 MB of panel BFF
// captures). Refresh the snapshots, then re-run this script.
//
// Today this script loads:
//   - TRENDYOL commission rates (CATEGORY + CATEGORY_BRAND)
//
// Future buckets that fit here (FeeDefinition, ShippingTariff baremleri)
// can register additional loaders below and stay behind the same entry
// point.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });

// ─── Snapshot wire shape ───────────────────────────────────────────────

interface SnapshotWrapper<TRow> {
  fetchedAt: string;
  env: 'stage' | 'prod';
  supplierId: number;
  source: { host: string; path: string; screen: string };
  totalElements: number;
  rows: TRow[];
}

// commission/commissionRate, paymentTerm, and categoryName are all nullable
// in stage data: the Trendyol test panel returns rows for categories whose
// rate/name hasn't been provisioned yet. Loader skips rows missing any
// required field and reports the dropped count.
interface CategoryRow {
  categoryId: number;
  parentCategoryName: string | null;
  categoryName: string | null;
  paymentTerm: number | null;
  commission: number | string | null;
  ka1Commission: number | string | null;
  ka2Commission: number | string | null;
  na1Commission: number | string | null;
  microSegmentCommission: number | string | null;
}

interface CategoryBrandRow {
  categoryId: number;
  brandId: number;
  categoryName: string;
  brandName: string;
  paymentTerm: number | null;
  commissionRate: number | string | null;
  ka1Commission: number | string | null;
  ka2Commission: number | string | null;
  na1Commission: number | string | null;
}

const SNAPSHOT_DIR = path.resolve(__dirname, '../../../tmp/trendyol/reference');
const CHUNK_SIZE = 1000;

function buildCategorySegmentOverrides(row: CategoryRow): Record<string, string> {
  const out: Record<string, string> = {};
  if (row.ka1Commission !== null) out['ka1'] = String(row.ka1Commission);
  if (row.ka2Commission !== null) out['ka2'] = String(row.ka2Commission);
  if (row.na1Commission !== null) out['na1'] = String(row.na1Commission);
  if (row.microSegmentCommission !== null) {
    out['microSegment'] = String(row.microSegmentCommission);
  }
  return out;
}

function buildCategoryBrandSegmentOverrides(row: CategoryBrandRow): Record<string, string> {
  const out: Record<string, string> = {};
  if (row.ka1Commission !== null) out['ka1'] = String(row.ka1Commission);
  if (row.ka2Commission !== null) out['ka2'] = String(row.ka2Commission);
  if (row.na1Commission !== null) out['na1'] = String(row.na1Commission);
  return out;
}

// ─── Loader ────────────────────────────────────────────────────────────

interface SeedRateRecord {
  platform: 'TRENDYOL';
  ruleKind: 'CATEGORY' | 'CATEGORY_BRAND';
  categoryId: bigint;
  brandId: bigint | null;
  categoryName: string;
  parentCategoryName: string | null;
  brandName: string | null;
  baseRate: string;
  paymentTermDays: number;
  segmentOverrides: Record<string, string>;
  fetchedAt: Date;
  sourceScreen: string;
}

type LoadResult =
  | { status: 'loaded'; count: number; droppedNullRows: number }
  | { status: 'skipped'; reason: string };

async function loadSnapshot(args: {
  fileName: string;
  platform: 'TRENDYOL';
  ruleKind: 'CATEGORY' | 'CATEGORY_BRAND';
}): Promise<LoadResult> {
  const fullPath = path.join(SNAPSHOT_DIR, args.fileName);
  if (!existsSync(fullPath)) {
    return { status: 'skipped', reason: `${args.fileName} not found under tmp/trendyol/reference` };
  }

  let records: SeedRateRecord[];
  let droppedNullRows = 0;

  if (args.ruleKind === 'CATEGORY') {
    const snapshot = JSON.parse(readFileSync(fullPath, 'utf-8')) as SnapshotWrapper<CategoryRow>;
    const fetchedAt = new Date(snapshot.fetchedAt);
    records = [];
    for (const r of snapshot.rows) {
      if (r.commission === null || r.paymentTerm === null || r.categoryName === null) {
        droppedNullRows += 1;
        continue;
      }
      records.push({
        platform: args.platform,
        ruleKind: 'CATEGORY',
        categoryId: BigInt(r.categoryId),
        brandId: null,
        categoryName: r.categoryName,
        parentCategoryName: r.parentCategoryName,
        brandName: null,
        baseRate: String(r.commission),
        paymentTermDays: r.paymentTerm,
        segmentOverrides: buildCategorySegmentOverrides(r),
        fetchedAt,
        sourceScreen: snapshot.source.screen,
      });
    }
  } else {
    const snapshot = JSON.parse(
      readFileSync(fullPath, 'utf-8'),
    ) as SnapshotWrapper<CategoryBrandRow>;
    const fetchedAt = new Date(snapshot.fetchedAt);
    records = [];
    for (const r of snapshot.rows) {
      if (r.commissionRate === null || r.paymentTerm === null) {
        droppedNullRows += 1;
        continue;
      }
      records.push({
        platform: args.platform,
        ruleKind: 'CATEGORY_BRAND',
        categoryId: BigInt(r.categoryId),
        brandId: BigInt(r.brandId),
        categoryName: r.categoryName,
        parentCategoryName: null,
        brandName: r.brandName,
        baseRate: String(r.commissionRate),
        paymentTermDays: r.paymentTerm,
        segmentOverrides: buildCategoryBrandSegmentOverrides(r),
        fetchedAt,
        sourceScreen: snapshot.source.screen,
      });
    }
  }

  // Idempotent REPLACE-by-(platform, ruleKind). Same contract a future
  // refresh endpoint will use.
  await prisma.marketplaceCommissionRate.deleteMany({
    where: { platform: args.platform, ruleKind: args.ruleKind },
  });

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    await prisma.marketplaceCommissionRate.createMany({ data: chunk });
  }

  return { status: 'loaded', count: records.length, droppedNullRows };
}

async function seedTrendyolCommissionRates(): Promise<void> {
  const targets: Array<{
    fileName: string;
    platform: 'TRENDYOL';
    ruleKind: 'CATEGORY' | 'CATEGORY_BRAND';
    label: string;
  }> = [
    {
      fileName: 'prod-category-commissions.json',
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY',
      label: 'TRENDYOL · category       ',
    },
    {
      fileName: 'prod-category-brand-commissions.json',
      platform: 'TRENDYOL',
      ruleKind: 'CATEGORY_BRAND',
      label: 'TRENDYOL · category+brand ',
    },
  ];

  let total = 0;
  let loaded = 0;
  let skipped = 0;

  for (const t of targets) {
    const result = await loadSnapshot({
      fileName: t.fileName,
      platform: t.platform,
      ruleKind: t.ruleKind,
    });
    if (result.status === 'loaded') {
      const tail =
        result.droppedNullRows > 0
          ? ` (${result.droppedNullRows.toString()} null-rate rows dropped)`
          : '';
      console.log(`  ✓ ${t.label} ${result.count.toString().padStart(7)} rows${tail}`);
      total += result.count;
      loaded += 1;
    } else {
      console.log(`  · ${t.label} skipped (${result.reason})`);
      skipped += 1;
    }
  }

  if (loaded === 0) {
    console.log(
      `✓ commission rates: no snapshots loaded (${skipped.toString()} skipped) — capture them and drop them under tmp/trendyol/reference/`,
    );
    return;
  }
  console.log(
    `✓ commission rates: ${total.toString()} rows across ${loaded.toString()} snapshot(s)${
      skipped > 0 ? ` (${skipped.toString()} skipped)` : ''
    }`,
  );
}

// ─── FeeDefinition seed (migration-embedded) ───────────────────────────
// `db:push` (the dev loop) never executes migration SQL, so a fresh or
// reset DB ends up with an EMPTY fee_definitions table — and order intake
// then fails per-order with FeeDefinitionNotFoundError while the sync
// still reports COMPLETED (found live during the 2026-06-10 PR-8 stage
// validation). The rows live inside their migrations (PR-2 + PR-8
// pattern); re-execute just the seed sections here, idempotent via
// ON CONFLICT DO NOTHING. Mirrors apps/api/tests/helpers/seed-fee-definitions.ts.
// Order matters: the denetim-A migration's seed section runs AFTER the PR-2 seed
// (it DELETEs the PR-2 TRENDYOL STOPPAGE and replaces it with the 'ALL' row).
const FEE_SEED_MIGRATIONS = [
  '../prisma/migrations/20260519175540_fee_definitions_trendyol_seed/migration.sql',
  '../prisma/migrations/20260610090000_cargo_invoice_foundation/migration.sql',
  '../prisma/migrations/20260614020000_fee_scope_commission_vat/migration.sql',
  '../prisma/migrations/20260624120100_international_service_fee_seed/migration.sql',
].map((rel) => path.resolve(__dirname, rel));

const FEE_SEED_MARKER = '-- ─── Seed: fee_definitions';

async function seedFeeDefinitions(): Promise<void> {
  for (const file of FEE_SEED_MIGRATIONS) {
    const full = readFileSync(file, 'utf-8');
    const start = full.indexOf(FEE_SEED_MARKER);
    if (start === -1) {
      throw new Error(
        `FeeDefinition seed section ("${FEE_SEED_MARKER}") not found in ${file} — ` +
          'update FEE_SEED_MIGRATIONS/FEE_SEED_MARKER if the migration was restructured.',
      );
    }
    await prisma.$executeRawUnsafe(full.substring(start));
  }
  // Scope is mixed since denetim A (FeeScope): TRENDYOL rows + pazaryeri-agnostik
  // ALL rows (STOPPAGE, COMMISSION_INVOICE). Count over all of them.
  const count = await prisma.feeDefinition.count();
  console.log(`✓ fee definitions: ${count.toString()} rows ensured`);
}

// Mikro ihracat "Yurt Dışı İade Operasyon Bedeli" kademe oranları. Aynı pattern:
// migration'ın marked seed section'ı idempotent (ON CONFLICT DO NOTHING) replay edilir.
const MICRO_RETURN_TIER_SEED_MIGRATION = path.resolve(
  __dirname,
  '../prisma/migrations/20260625120000_micro_export_return_fee_tiers/migration.sql',
);
const MICRO_RETURN_TIER_SEED_MARKER = '-- ─── Seed: micro_export_return_fee_tiers';

async function seedMicroExportReturnTiers(): Promise<void> {
  const full = readFileSync(MICRO_RETURN_TIER_SEED_MIGRATION, 'utf-8');
  const start = full.indexOf(MICRO_RETURN_TIER_SEED_MARKER);
  if (start === -1) {
    throw new Error(
      `Micro-export return tier seed section ("${MICRO_RETURN_TIER_SEED_MARKER}") not found in ` +
        MICRO_RETURN_TIER_SEED_MIGRATION,
    );
  }
  await prisma.$executeRawUnsafe(full.substring(start));
  const count = await prisma.microExportReturnFeeTier.count();
  console.log(`✓ micro-export return fee tiers: ${count.toString()} rows ensured`);
}

async function main(): Promise<void> {
  console.log('Loading reference data — safe to re-run on a populated DB.\n');
  await seedFeeDefinitions();
  await seedMicroExportReturnTiers();
  await seedTrendyolCommissionRates();
  console.log('\n✓ Reference seed complete.');
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
