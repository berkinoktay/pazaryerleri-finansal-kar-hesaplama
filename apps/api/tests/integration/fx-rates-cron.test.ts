/**
 * Integration test for the FX rates cron sync logic.
 *
 * Tests the parser + Prisma upsert path end-to-end, using a fixture XML that
 * mirrors the real TCMB bulletin format. The Edge Function runtime (Deno) is
 * not exercised here — we test the two parts that contain logic:
 *   1. parseTcmbXml  (pure parser, also tested in unit/fx-rates/tcmb-parser.test.ts)
 *   2. fx_rates upsert (idempotency invariant from @@unique([currency, rateDate]))
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseTcmbXml } from '../../../../supabase/functions/fx-rates-sync/tcmb-parser';
import { ensureDbReachable, prisma, truncateAll } from '../helpers/db';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_XML = readFileSync(
  join(here, '../../../../supabase/functions/fx-rates-sync/_test_/fixtures/tcmb-sample.xml'),
  'utf-8',
);

describe('fx-rates-sync cron integration', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('writes USD and EUR rows with correct rate and source', async () => {
    const rates = parseTcmbXml(FIXTURE_XML);
    await upsertRates(rates.USD, rates.EUR, rates.rateDate);

    const rows = await prisma.fxRate.findMany({
      where: { rateDate: rates.rateDate },
      orderBy: { currency: 'asc' },
    });

    expect(rows).toHaveLength(2);

    const eur = rows.find((r) => r.currency === 'EUR');
    const usd = rows.find((r) => r.currency === 'USD');

    expect(usd).toBeDefined();
    expect(usd!.rateToTry.toFixed(4)).toBe('45.1900');
    expect(usd!.source).toBe('TCMB');

    expect(eur).toBeDefined();
    expect(eur!.rateToTry.toFixed(4)).toBe('53.1363');
    expect(eur!.source).toBe('TCMB');

    // Rate date must round-trip correctly (stored as DATE, no time component).
    expect(usd!.rateDate.getUTCFullYear()).toBe(2026);
    expect(usd!.rateDate.getUTCMonth()).toBe(4); // May = 4
    expect(usd!.rateDate.getUTCDate()).toBe(8);
  });

  it('is idempotent — running twice on the same day does not create duplicate rows', async () => {
    const rates = parseTcmbXml(FIXTURE_XML);

    // First run
    await upsertRates(rates.USD, rates.EUR, rates.rateDate);
    // Second run (same data, same date)
    await upsertRates(rates.USD, rates.EUR, rates.rateDate);

    const count = await prisma.fxRate.count({ where: { rateDate: rates.rateDate } });
    expect(count).toBe(2); // exactly one USD row + one EUR row
  });

  it('updates the rate when the same date is upserted with a new value', async () => {
    const rates = parseTcmbXml(FIXTURE_XML);

    await upsertRates(rates.USD, rates.EUR, rates.rateDate);

    // Simulate a corrected bulletin with a slightly different rate.
    const revisedUsd = '45.5000';
    await upsertRates(revisedUsd, rates.EUR, rates.rateDate);

    const usd = await prisma.fxRate.findFirst({
      where: { currency: 'USD', rateDate: rates.rateDate },
    });
    expect(usd!.rateToTry.toFixed(4)).toBe('45.5000');
  });
});

// ─── Helper: mirrors the upsert logic inside the Edge Function ────────────────

async function upsertRates(usdStr: string, eurStr: string, rateDate: Date): Promise<void> {
  // Prisma upsert on @@unique([currency, rateDate]) — matches the Edge Function's
  // Supabase client upsert with onConflict: 'currency,rate_date'.
  const rateDateDay = new Date(
    Date.UTC(rateDate.getUTCFullYear(), rateDate.getUTCMonth(), rateDate.getUTCDate()),
  );

  await prisma.fxRate.upsert({
    where: { currency_rateDate: { currency: 'USD', rateDate: rateDateDay } },
    update: { rateToTry: new Decimal(usdStr), source: 'TCMB' },
    create: {
      currency: 'USD',
      rateDate: rateDateDay,
      rateToTry: new Decimal(usdStr),
      source: 'TCMB',
    },
  });

  await prisma.fxRate.upsert({
    where: { currency_rateDate: { currency: 'EUR', rateDate: rateDateDay } },
    update: { rateToTry: new Decimal(eurStr), source: 'TCMB' },
    create: {
      currency: 'EUR',
      rateDate: rateDateDay,
      rateToTry: new Decimal(eurStr),
      source: 'TCMB',
    },
  });
}
