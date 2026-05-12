/**
 * One-shot local seed: fetch today's TCMB FX rates and upsert into fx_rates.
 *
 * The Edge Function `supabase/functions/fx-rates-sync` runs this same logic
 * daily at 16:00 Istanbul via pg_cron in production. Locally the cron does
 * not run, so the table is empty and the cost-profile form's FX preview
 * stays in its "loading" state forever. Run this script once and the form
 * works for the rest of the day.
 *
 * Usage:
 *   pnpm --filter @pazarsync/api fx:seed
 *
 * Re-runs are idempotent (upsert on `currency, rate_date`).
 */

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import { Currency } from '@pazarsync/db/enums';

import { parseTcmbXml } from '../../../supabase/functions/fx-rates-sync/tcmb-parser';

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';

async function main(): Promise<void> {
  process.stdout.write(`[fx:seed] fetching ${TCMB_URL}…\n`);
  const response = await fetch(TCMB_URL);
  if (!response.ok) {
    throw new Error(`TCMB HTTP ${response.status} ${response.statusText}`);
  }
  const xml = await response.text();
  const rates = parseTcmbXml(xml);
  const rateDate = rates.rateDate; // UTC midnight

  const rows = [
    { currency: Currency.USD, rate: rates.USD },
    { currency: Currency.EUR, rate: rates.EUR },
  ];

  for (const row of rows) {
    await prisma.fxRate.upsert({
      where: {
        currency_rateDate: { currency: row.currency, rateDate },
      },
      create: {
        currency: row.currency,
        rateDate,
        rateToTry: new Decimal(row.rate),
        source: 'TCMB',
        fetchedAt: new Date(),
      },
      update: {
        rateToTry: new Decimal(row.rate),
        source: 'TCMB',
        fetchedAt: new Date(),
      },
    });
  }

  const dateStr = rateDate.toISOString().slice(0, 10);
  process.stdout.write(`[fx:seed] OK — USD=${rates.USD} EUR=${rates.EUR} rateDate=${dateStr}\n`);
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`[fx:seed] FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
