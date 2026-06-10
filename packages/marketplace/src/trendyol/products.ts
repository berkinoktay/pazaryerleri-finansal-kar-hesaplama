// Public API of the Trendyol product-sync integration. Exposes an async
// generator that pages through /products/approved (v2), maps each batch
// to internal DTOs, and stops when the catalog is exhausted. Has no DB
// or Prisma awareness — the caller (ProductSyncService) handles upsert.
//
// Source-of-truth for endpoint shape:
//   docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
//     urun-entegrasyonlari-v2.md

import type { StoreEnvironment } from '@pazarsync/db';

import { fetchOnce, type FetcherDeps } from './fetch-once';
import { baseUrlFor } from './headers';
import { mapTrendyolApprovedResponse, type MappedProductsPage } from './mapper';
import type { TrendyolApprovedProductsResponse, TrendyolCredentials } from './types';

/**
 * Trendyol getApprovedProducts page size.
 *
 * The cap formula in
 * docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/urun-entegrasyonlari-v2.md §3
 * says "Page x size maksimum 10.000 değerini alabilir." — this is the
 * PAGINATION cap (after which nextPageToken is required), not the
 * per-request size limit. The doc only shows `size=100` examples for
 * the approved endpoint; PR #88 bumped to 1000 hoping the cap formula
 * implied size=1000 was supported, but Trendyol's approved endpoint
 * empirically returns 400 on size=1000 (per a real sandbox sync with
 * a small catalog, immediate fail on page 0). 100 is the known-good
 * max — confirmed by working dev syncs of 5,624-product catalogs
 * across multiple sessions.
 *
 * Exported because the sync-worker's token→page fallback math
 * (apps/sync-worker/src/handlers/products.ts) uses the same constant.
 * Single source of truth.
 */
export const PRODUCTS_PAGE_SIZE = 100;
/**
 * Trendyol's documented page-based pagination cap (same doc as above).
 * Items 0–9999 are reachable via `page=N`; item 10000+ requires
 * `nextPageToken`.
 *
 * Exported for the same reason as PRODUCTS_PAGE_SIZE — the worker's
 * token-fallback recomputation references this cap.
 */
export const APPROVED_PAGE_CAP_ITEMS = 10_000;

interface PageRequest {
  size: number;
  page?: number;
  nextPageToken?: string;
}

function buildUrl(base: string, supplierId: string, req: PageRequest): string {
  const url = new URL(`${base}/integration/product/sellers/${supplierId}/products/approved`);
  url.searchParams.set('size', req.size.toString());
  if (req.nextPageToken !== undefined) {
    url.searchParams.set('nextPageToken', req.nextPageToken);
  } else if (req.page !== undefined) {
    url.searchParams.set('page', req.page.toString());
  }
  return url.toString();
}

export interface FetchApprovedProductsOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
  /**
   * Resume from a previously-saved cursor. Existing callers pass `undefined`
   * (or omit) to start from page 0. The sync-worker's chunked dispatcher
   * passes the parsed cursor decoded from `SyncLog.pageCursor` so each
   * invocation processes exactly one page and yields back to the queue.
   */
  initialCursor?: { kind: 'page'; n: number } | { kind: 'token'; token: string } | null;
}

/**
 * Async generator over Trendyol's /products/approved endpoint. Yields one
 * page at a time, fully mapped. Caller decides whether to upsert each
 * batch or buffer.
 *
 * Pagination: `page=0..N` while page*size ≤ 10,000; switches to
 * `nextPageToken` when Trendyol returns one (which it does past the
 * 10k cap). Stops when an empty `content[]` is returned or all
 * `totalElements` rows have been streamed.
 *
 * Either `baseUrl` or `environment` must be supplied; in app code use
 * `environment` (resolves from env vars). Tests can pass `baseUrl`
 * directly to point at an MSW mock.
 */
export async function* fetchApprovedProducts(
  opts: FetchApprovedProductsOpts,
): AsyncGenerator<MappedProductsPage, void> {
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    credentials: opts.credentials,
    env,
    signal: opts.signal,
  };

  let processedSoFar = 0;
  let totalElements: number | null = null;
  // Resume support: when an `initialCursor` is supplied, start at that
  // page index OR carry the saved nextPageToken into the first request.
  // No cursor → fresh sync from page 0 (existing behavior).
  let page = opts.initialCursor?.kind === 'page' ? opts.initialCursor.n : 0;
  let pendingToken: string | undefined =
    opts.initialCursor?.kind === 'token' ? opts.initialCursor.token : undefined;

  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = buildUrl(base, opts.credentials.supplierId, {
      size: PRODUCTS_PAGE_SIZE,
      page: pendingToken === undefined ? page : undefined,
      nextPageToken: pendingToken,
    });

    const raw = await fetchOnce<TrendyolApprovedProductsResponse>(url, deps);
    const mapped = mapTrendyolApprovedResponse(raw);

    if (totalElements === null) totalElements = mapped.pageMeta.totalElements;

    if (mapped.batch.length === 0) return;

    yield mapped;
    processedSoFar += mapped.batch.length;

    if (totalElements !== null && processedSoFar >= totalElements) return;

    // Default to page-based pagination — that's the documented contract
    // below the 10k cap and avoids the deterministic 500s observed on
    // some nextPageToken values. Switch to nextPageToken ONLY when the
    // next page would cross the cap and Trendyol gave us a token.
    const nextPage = page + 1;
    const nextWouldCrossCap = nextPage * PRODUCTS_PAGE_SIZE >= APPROVED_PAGE_CAP_ITEMS;

    if (nextWouldCrossCap) {
      if (mapped.pageMeta.nextPageToken !== null) {
        pendingToken = mapped.pageMeta.nextPageToken;
      } else {
        // Past the 10k cap with no token — Trendyol gave us no way
        // forward. Stop iteration; this catalog's tail beyond 10k is
        // unreachable through this endpoint without a token.
        return;
      }
    } else {
      pendingToken = undefined;
      page = nextPage;
    }
  }
}
