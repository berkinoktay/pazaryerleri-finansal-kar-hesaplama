/**
 * fx-rates-sync — Supabase Edge Function
 *
 * Fetches today's FX rates from TCMB (Türkiye Cumhuriyet Merkez Bankası)
 * and upserts them into the `fx_rates` table. Invoked daily at 16:00 Istanbul
 * time (13:00 UTC) on business days via pg_cron + pg_net.
 *
 * Retry policy: 3 attempts with exponential backoff (15 s → 45 s → 120 s).
 * On final failure, logs the error to stderr. A SyncLog-based alerting
 * pipeline for global (non-org-scoped) jobs is out-of-scope for this PR —
 * the SyncLog table requires organizationId + storeId (tenant-scoped); that
 * extension is deferred to the snapshot-capture PR.
 */

import '@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

import { parseTcmbXml, TcmbParseError } from './tcmb-parser.ts';

const TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';

/** Delay durations in milliseconds for each retry attempt (0-indexed). */
const RETRY_DELAYS_MS = [15_000, 45_000, 120_000] as const;

const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 4 total: 1 initial + 3 retries

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    console.error('[fx-rates-sync] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return new Response('Missing environment variables', { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const xml = await fetchTcmbXml();
      const rates = parseTcmbXml(xml);

      const rateDateStr = rates.rateDate.toISOString().slice(0, 10); // 'YYYY-MM-DD'
      const fetchedAt = new Date().toISOString();

      const rows = [
        {
          currency: 'USD',
          rate_date: rateDateStr,
          rate_to_try: rates.USD,
          source: 'TCMB',
          fetched_at: fetchedAt,
        },
        {
          currency: 'EUR',
          rate_date: rateDateStr,
          rate_to_try: rates.EUR,
          source: 'TCMB',
          fetched_at: fetchedAt,
        },
      ];

      const { error } = await supabase
        .from('fx_rates')
        .upsert(rows, { onConflict: 'currency,rate_date' });

      if (error) {
        throw new Error(`Supabase upsert failed: ${error.message}`);
      }

      console.log(
        `[fx-rates-sync] OK — USD=${rates.USD} EUR=${rates.EUR} date=${rateDateStr} attempt=${attempt}`,
      );
      return new Response(
        JSON.stringify({ ok: true, date: rateDateStr, USD: rates.USD, EUR: rates.EUR }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (err) {
      lastError = err;
      const isParseError = err instanceof TcmbParseError;
      console.error(
        `[fx-rates-sync] attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : String(err),
      );

      // Parse errors are non-retryable — TCMB format change requires code fix.
      if (isParseError || attempt === MAX_ATTEMPTS) {
        break;
      }

      const delayMs = RETRY_DELAYS_MS[attempt - 1];
      console.log(`[fx-rates-sync] retrying in ${delayMs / 1000}s…`);
      await sleep(delayMs);
    }
  }

  // All attempts exhausted. Log the final error.
  // NOTE: SyncLog alerting for global jobs is not yet implemented — the
  // SyncLog table is tenant-scoped (requires organizationId + storeId).
  // This is a known gap tracked in the PR 5 cost-snapshot work.
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  console.error(`[fx-rates-sync] FINAL FAILURE after ${MAX_ATTEMPTS} attempts: ${msg}`);

  return new Response(JSON.stringify({ ok: false, error: 'FX_FETCH_FAILED', detail: msg }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ─── Private helpers ──────────────────────────────────────────────────────────

async function fetchTcmbXml(): Promise<string> {
  const response = await fetch(TCMB_URL);
  if (!response.ok) {
    throw new Error(`TCMB HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
