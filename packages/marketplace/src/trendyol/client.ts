import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable } from '@pazarsync/sync-core';

import { mapTrendyolResponseToDomainError } from './errors';
import { baseUrlFor, buildAuthHeader, buildUserAgent } from './headers';
import type { TrendyolCredentials } from './types';

const TIMEOUT_MS = 10_000;
const PLATFORM = 'TRENDYOL';

/**
 * Cheapest credentials-proof probe for Trendyol: the approved-products v2
 * endpoint (page 0, size 1). Returns 200 even for sellers with zero
 * products, proves auth + supplierId ownership in one call. The V1
 * product-filter endpoint (`/products?approved=true`) used here before was
 * announced deprecated for 15 Oct 2026 (Trendyol changelog), so the probe
 * rides the same v2 endpoint the catalog sync already depends on.
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
  const url = `${base}/integration/product/sellers/${cred.supplierId}/products/approved?page=0&size=1`;

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
  } catch {
    // Network error / timeout / DNS — treat as upstream unreachable.
    // We do NOT leak err.message (may contain IP / hostname) to callers.
    throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
  }
  if (!res.ok) mapTrendyolResponseToDomainError(res, env);
}
