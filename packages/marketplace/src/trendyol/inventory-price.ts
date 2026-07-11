// Public API of the Trendyol inventory-and-price fetcher. Exposes an async
// generator that pages through /products/approved/inventory-and-price (the
// "stock and price only" projection of the approved-products endpoint),
// flattens each page's content.variants[] into a single batch, and stops
// when the catalog is exhausted. Has no DB or Prisma awareness — the caller
// (the PRODUCTS_DELTA handler) diffs each batch against the current DB state.
//
// Structurally a twin of ./products.ts (fetchApprovedProducts): identical
// page/token pagination, the same 10,000-item page cap, and the same
// fetchOnce usage (auth headers, env base URL, retry, timeout composition).
//
// Source-of-truth for endpoint shape:
//   docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
//     urun-entegrasyonu-v2/urun-filtreleme-onayli-urun-v2-stok-ve-fiyat.md

import type { StoreEnvironment } from '@pazarsync/db';

import { fetchOnce, type FetcherDeps } from './fetch-once';
import { baseUrlFor } from './headers';
import { priceToDecimalString } from './mapper';
import { APPROVED_PAGE_CAP_ITEMS, PRODUCTS_PAGE_SIZE } from './products';
import type {
  MappedInventoryPage,
  MappedInventoryVariant,
  TrendyolInventoryAndPriceResponse,
  TrendyolInventoryVariant,
  TrendyolCredentials,
} from './types';

interface PageRequest {
  size: number;
  page?: number;
  nextPageToken?: string;
}

function buildUrl(base: string, supplierId: string, req: PageRequest): string {
  const url = new URL(
    `${base}/integration/product/sellers/${supplierId}/products/approved/inventory-and-price`,
  );
  url.searchParams.set('size', req.size.toString());
  if (req.nextPageToken !== undefined) {
    url.searchParams.set('nextPageToken', req.nextPageToken);
  } else if (req.page !== undefined) {
    url.searchParams.set('page', req.page.toString());
  }
  return url.toString();
}

function mapInventoryVariant(variant: TrendyolInventoryVariant): MappedInventoryVariant {
  return {
    platformVariantId: BigInt(variant.variantId),
    barcode: variant.barcode,
    // Missing quantity / prices (freshly-listed variants mid-pricing-pipeline)
    // collapse to a sane default rather than crashing the page — same defensive
    // convention as the full-catalog mapper. Money stays a 2-dp decimal string.
    quantity: variant.quantity ?? 0,
    salePrice: priceToDecimalString(variant.salePrice),
    listPrice: priceToDecimalString(variant.listPrice),
  };
}

function mapInventoryResponse(response: TrendyolInventoryAndPriceResponse): MappedInventoryPage {
  const batch: MappedInventoryVariant[] = [];
  for (const content of response.content) {
    for (const variant of content.variants ?? []) {
      batch.push(mapInventoryVariant(variant));
    }
  }
  return {
    batch,
    contentCount: response.content.length,
    pageMeta: {
      totalElements: response.totalElements,
      totalPages: response.totalPages,
      page: response.page,
      size: response.size,
      nextPageToken: response.nextPageToken ?? null,
    },
  };
}

export interface FetchInventoryAndPriceOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
  /**
   * Resume from a previously-saved cursor. The PRODUCTS_DELTA handler passes
   * the parsed cursor decoded from `SyncLog.pageCursor` so each invocation
   * processes exactly one page and yields back to the queue. `undefined`/null
   * starts from page 0.
   */
  initialCursor?: { kind: 'page'; n: number } | { kind: 'token'; token: string } | null;
}

/**
 * Async generator over Trendyol's /products/approved/inventory-and-price
 * endpoint. Yields one page at a time, flattened to a per-variant batch plus
 * page metadata. The caller diffs each batch against the DB.
 *
 * Pagination mirrors fetchApprovedProducts exactly: `page=0..N` while
 * page*size <= 10,000; switches to `nextPageToken` only when the next page
 * would cross the cap and Trendyol returned a token. Stops when a page has no
 * content or all `totalElements` content items have been streamed.
 */
export async function* fetchInventoryAndPrice(
  opts: FetchInventoryAndPriceOpts,
): AsyncGenerator<MappedInventoryPage, void> {
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    credentials: opts.credentials,
    env,
    signal: opts.signal,
  };

  let processedSoFar = 0;
  let totalElements: number | null = null;
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

    const raw = await fetchOnce<TrendyolInventoryAndPriceResponse>(url, deps);
    const mapped = mapInventoryResponse(raw);

    if (totalElements === null) totalElements = mapped.pageMeta.totalElements;

    if (mapped.contentCount === 0) return;

    yield mapped;
    processedSoFar += mapped.contentCount;

    if (totalElements !== null && processedSoFar >= totalElements) return;

    // Page-based is the default below the 10k cap; switch to nextPageToken
    // ONLY when the next page would cross the cap AND Trendyol gave us a token.
    const nextPage = page + 1;
    const nextWouldCrossCap = nextPage * PRODUCTS_PAGE_SIZE >= APPROVED_PAGE_CAP_ITEMS;

    if (nextWouldCrossCap) {
      if (mapped.pageMeta.nextPageToken !== null) {
        pendingToken = mapped.pageMeta.nextPageToken;
      } else {
        // Past the 10k cap with no token — the tail beyond 10k is unreachable
        // through this endpoint. Stop; the chunk handler logs the truncation
        // with full context (products-delta.catalog-truncated-10k).
        return;
      }
    } else {
      pendingToken = undefined;
      page = nextPage;
    }
  }
}
