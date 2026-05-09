import { Decimal } from 'decimal.js';

import { createRoute, z } from '@hono/zod-openapi';

import { prisma } from '@pazarsync/db';
import { Currency } from '@pazarsync/db/enums';

import { createSubApp } from '../../lib/create-hono-app';
import { ensureOrgMember } from '../../lib/ensure-org-member';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';

const app = createSubApp<{ Variables: { userId: string } }>();

const orgIdParam = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
});

const FxRateEntrySchema = z
  .object({
    rate: z
      .string()
      .openapi({ description: 'Rate to TRY, as a decimal string.', example: '38.5220' }),
    date: z
      .string()
      .openapi({ description: 'Rate date (ISO 8601 date string).', example: '2026-05-09' }),
    source: z.string().openapi({ description: 'Data source.', example: 'TCMB' }),
  })
  .openapi('FxRateEntry');

const FxRatesLatestResponseSchema = z
  .object({
    USD: FxRateEntrySchema.nullable().openapi({
      description: 'Latest USD/TRY rate. Null when no rate has been fetched yet.',
    }),
    EUR: FxRateEntrySchema.nullable().openapi({
      description: 'Latest EUR/TRY rate. Null when no rate has been fetched yet.',
    }),
  })
  .openapi('FxRatesLatestResponse');

const fxRatesLatestRoute = createRoute({
  method: 'get',
  path: '/organizations/{orgId}/fx-rates/latest',
  tags: ['FxRates'],
  summary: 'Get the latest FX rates (USD, EUR → TRY)',
  description:
    'Returns the most-recent cached exchange rate for each non-TRY currency. ' +
    'The route is org-scoped for API-surface consistency; the data is global (rates are not ' +
    'filtered by organization). Rates are populated daily by the TCMB Edge Function cron job. ' +
    'A null entry means the rate has never been fetched — the AUTO FX flow will fall back to null ' +
    'cost snapshots until the cron succeeds.',
  security: [{ bearerAuth: [] }],
  request: { params: orgIdParam },
  responses: {
    200: {
      content: { 'application/json': { schema: FxRatesLatestResponseSchema } },
      description: 'Latest FX rates per currency',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    403: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Not a member of this organization',
    },
    429: Common429Response,
  },
});

// The non-TRY currencies we surface on the FX rates endpoint.
const NON_TRY_CURRENCIES = [Currency.USD, Currency.EUR] as const;
type NonTryCurrency = (typeof NON_TRY_CURRENCIES)[number];

interface FxRateEntry {
  rate: string;
  date: string;
  source: string;
}

async function fetchLatestFxRates(): Promise<Record<NonTryCurrency, FxRateEntry | null>> {
  // One query per currency, run in parallel. Each reads the single latest
  // row (ORDER BY rate_date DESC LIMIT 1) — cheap backward scan on the
  // unique index (currency, rate_date).
  const [usdRow, eurRow] = await Promise.all(
    NON_TRY_CURRENCIES.map((currency) =>
      prisma.fxRate.findFirst({
        where: { currency },
        orderBy: { rateDate: 'desc' },
      }),
    ),
  );

  function toEntry(
    row: { rateToTry: Decimal; rateDate: Date; source: string } | null,
  ): FxRateEntry | null {
    if (row === null) return null;
    return {
      rate: row.rateToTry.toString(),
      date: row.rateDate.toISOString().slice(0, 10),
      source: row.source,
    };
  }

  return {
    USD: toEntry(usdRow ?? null),
    EUR: toEntry(eurRow ?? null),
  };
}

app.openapi(fxRatesLatestRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  // Auth gate only — FX data is global, org scope is a routing convention.
  await ensureOrgMember(userId, orgId);
  const rates = await fetchLatestFxRates();
  return c.json(rates, 200);
});

export default app;
