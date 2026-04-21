import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable } from '../../../lib/errors';

import { mapTrendyolResponseToDomainError } from './errors';
import type { TrendyolCredentials } from './types';

const TIMEOUT_MS = 10_000;
const PLATFORM = 'TRENDYOL';

function baseUrlFor(env: StoreEnvironment): string {
  const url =
    env === 'PRODUCTION'
      ? process.env['TRENDYOL_PROD_BASE_URL']
      : process.env['TRENDYOL_SANDBOX_BASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(`Trendyol base URL not configured for environment ${env}`);
  }
  return url;
}

function buildAuthHeader(cred: TrendyolCredentials): string {
  const token = Buffer.from(`${cred.apiKey}:${cred.apiSecret}`).toString('base64');
  return `Basic ${token}`;
}

function buildUserAgent(cred: TrendyolCredentials): string {
  const suffix = process.env['TRENDYOL_INTEGRATOR_UA_SUFFIX'] ?? 'SelfIntegration';
  return `${cred.supplierId} - ${suffix}`;
}

/**
 * Cheapest credentials-proof probe for Trendyol: the product-filter
 * endpoint. 2000 req/min rate budget, returns 200 even for sellers
 * with zero products, proves auth + supplierId ownership in one call.
 *
 * Alternatives considered (docs/integrations/trendyol/1-servis-limitleri.md):
 *   - GET .../addresses — 1 req/hour (too tight for dev/test probing)
 *   - GET .../orders    — works but has additional auth scopes new
 *                         sellers may not have
 */
export async function probeTrendyolCredentials(
  cred: TrendyolCredentials,
  env: StoreEnvironment,
): Promise<void> {
  const base = baseUrlFor(env);
  const url = `${base}/integration/product/sellers/${cred.supplierId}/products?page=0&size=1&approved=true`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: buildAuthHeader(cred),
        'User-Agent': buildUserAgent(cred),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Network error / timeout / DNS — treat as upstream unreachable.
    // We do NOT leak err.message (may contain IP / hostname) to callers.
    throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
  }
  if (!res.ok) mapTrendyolResponseToDomainError(res);
}
