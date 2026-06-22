// Trendyol Price Update API — pure HTTP layer (DOMESTIC marketplace).
//
// Source-of-truth (docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
//   urun-entegrasyonu-v2/):
//     stok-ve-fiyat-guncelleme.md                  (POST .../price-and-inventory → batchRequestId)
//     getBatchRequestResult (developers.trendyol.com) (GET .../batch-requests/{id})
//
// Endpoints:
//   POST PROD:  https://apigw.trendyol.com/integration/inventory/sellers/{sellerId}/products/price-and-inventory
//   POST STAGE: https://stageapigw.trendyol.com/integration/inventory/sellers/{sellerId}/products/price-and-inventory
//   GET  PROD:  https://apigw.trendyol.com/integration/product/sellers/{sellerId}/products/batch-requests/{batchRequestId}
//   GET  STAGE: https://stageapigw.trendyol.com/integration/product/sellers/{sellerId}/products/batch-requests/{batchRequestId}
//
// Trendyol fiyat yazması ASENKRON: POST → batchRequestId; sonuç getBatchRequestResult
// ile yoklanır. Stok ve fiyat AYRI gönderilebilir — biz yalnız salePrice/listPrice
// göndeririz (quantity yok), böylece satılabilir STOK BİLGİSİNE DOKUNULMAZ.
// Aynı body ile tekrar istek 15 dakika boyunca reddedilir; fiyat değiştirilebilir.

import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable, ValidationError } from '@pazarsync/sync-core';
import Decimal from 'decimal.js';

import type { PriceBatchItem, PriceUpdateItem } from '../types';
import { mapTrendyolResponseToDomainError } from './errors';
import { baseUrlFor, buildAuthHeader, buildUserAgent } from './headers';
import type { TrendyolCredentials } from './types';

const PLATFORM = 'TRENDYOL';
const TIMEOUT_MS = 30_000;

/** Trendyol's documented per-request item limit for price/stock updates. */
export const MAX_PRICES_PER_REQUEST = 1_000;

export interface UpdatePricesOpts {
  credentials: TrendyolCredentials;
  environment: StoreEnvironment;
  items: PriceUpdateItem[];
  signal?: AbortSignal;
}

export interface CheckPriceBatchOpts {
  credentials: TrendyolCredentials;
  environment: StoreEnvironment;
  batchId: string;
  signal?: AbortSignal;
}

// ─── Wire shapes (Trendyol API) ──────────────────────────────────────────────

interface TrendyolPriceItem {
  barcode: string;
  /** KDV-dahil satış fiyatı. */
  salePrice: number;
  /** Tavsiye edilen liste fiyatı (opsiyonel; >= salePrice zorunlu). */
  listPrice?: number;
  // NOTE: `quantity` intentionally omitted — price-only update leaves stock
  // untouched (Trendyol allows sending price and stock separately).
}

interface TrendyolPriceUpdateBody {
  items: TrendyolPriceItem[];
}

interface TrendyolPriceUpdateResponse {
  batchRequestId: string;
}

interface TrendyolBatchRequestItem {
  requestItem: {
    barcode: string;
    salePrice?: number;
    listPrice?: number;
    quantity?: number;
  };
  /** Per-item outcome: "SUCCESS" | "FAILED". */
  status: string;
  failureReasons?: string[];
}

interface TrendyolBatchRequestResponse {
  batchRequestId: string;
  /**
   * Batch-level status: "IN_PROGRESS" | "COMPLETED". Trendyol may omit this for
   * stock/price batches — when absent, per-item results are authoritative.
   */
  status?: string;
  items?: TrendyolBatchRequestItem[];
  itemCount?: number;
  failedItemCount?: number;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateItems(items: PriceUpdateItem[]): void {
  if (items.length === 0) {
    throw new ValidationError([{ field: 'items', code: 'PRICE_UPDATE_ITEMS_EMPTY' }]);
  }
  if (items.length > MAX_PRICES_PER_REQUEST) {
    throw new ValidationError([
      {
        field: 'items',
        code: 'PRICE_UPDATE_ITEMS_EXCEED_LIMIT',
        meta: { limit: MAX_PRICES_PER_REQUEST, provided: items.length },
      },
    ]);
  }
  for (const item of items) {
    const sale = new Decimal(item.salePrice);
    if (sale.lte(0)) {
      throw new ValidationError([
        { field: 'salePrice', code: 'INVALID_SALE_PRICE', meta: { barcode: item.barcode } },
      ]);
    }
    if (item.listPrice !== undefined) {
      const list = new Decimal(item.listPrice);
      if (list.lt(sale)) {
        throw new ValidationError([
          {
            field: 'listPrice',
            code: 'LIST_PRICE_BELOW_SALE_PRICE',
            meta: { barcode: item.barcode },
          },
        ]);
      }
    }
  }
}

function toPriceItem(item: PriceUpdateItem): TrendyolPriceItem {
  const out: TrendyolPriceItem = {
    barcode: item.barcode,
    // Decimal → number for the Trendyol wire format. Money precision is
    // maintained as a decimal string throughout the domain layer; only at
    // the HTTP boundary do we convert to number (Trendyol's JSON schema
    // uses numeric literals, not strings).
    salePrice: new Decimal(item.salePrice).toNumber(),
  };
  if (item.listPrice !== undefined) {
    out.listPrice = new Decimal(item.listPrice).toNumber();
  }
  return out;
}

// ─── HTTP functions ──────────────────────────────────────────────────────────

/**
 * POST .../products/price-and-inventory — submit a batch price update.
 *
 * Returns `{ batchId }` (Trendyol's `batchRequestId`) immediately; the batch
 * processes asynchronously. Per-item success/failure is only known after
 * polling checkPriceBatchStatus. Stock is NOT touched (price-only body).
 */
export async function updatePrices(opts: UpdatePricesOpts): Promise<{ batchId: string }> {
  validateItems(opts.items);

  const base = baseUrlFor(opts.environment);
  const url = `${base}/integration/inventory/sellers/${opts.credentials.supplierId}/products/price-and-inventory`;

  const body: TrendyolPriceUpdateBody = {
    items: opts.items.map(toPriceItem),
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(opts.credentials),
        'User-Agent': buildUserAgent(opts.credentials),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
  }

  if (!res.ok) mapTrendyolResponseToDomainError(res, opts.environment);

  const parsed = (await res.json()) as TrendyolPriceUpdateResponse;
  if (typeof parsed.batchRequestId !== 'string' || parsed.batchRequestId.length === 0) {
    throw new MarketplaceUnreachable(PLATFORM, {
      httpStatus: res.status,
      responseBodySnippet: `batchRequestId missing in response: ${JSON.stringify(parsed).slice(0, 256)}`,
    });
  }

  return { batchId: parsed.batchRequestId };
}

/**
 * GET .../products/batch-requests/{batchRequestId} — poll the outcome of a batch
 * (getBatchRequestResult).
 *
 * `processing: true` while the batch is still running. Trendyol omits the
 * batch-level `status` for stock/price batches, so a missing status with no
 * items yet is also treated as "still processing"; once `items[]` carries
 * terminal per-item results (or status is "COMPLETED"), the batch is done.
 */
export async function checkPriceBatchStatus(opts: CheckPriceBatchOpts): Promise<{
  processing: boolean;
  items: PriceBatchItem[];
}> {
  const base = baseUrlFor(opts.environment);
  const url = `${base}/integration/product/sellers/${opts.credentials.supplierId}/products/batch-requests/${encodeURIComponent(
    opts.batchId,
  )}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: buildAuthHeader(opts.credentials),
        'User-Agent': buildUserAgent(opts.credentials),
        Accept: 'application/json',
      },
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
  }

  if (!res.ok) mapTrendyolResponseToDomainError(res, opts.environment);

  const parsed = (await res.json()) as TrendyolBatchRequestResponse;

  const batchItems = parsed.items ?? [];
  // Done when the batch reports COMPLETED, or (when status is omitted) once
  // per-item results have landed. IN_PROGRESS or an empty not-yet-COMPLETED
  // batch means keep polling.
  const processing =
    parsed.status === 'IN_PROGRESS' || (parsed.status !== 'COMPLETED' && batchItems.length === 0);

  const items: PriceBatchItem[] = batchItems.map((entry): PriceBatchItem => {
    const reasons = entry.failureReasons ?? [];
    return {
      barcode: entry.requestItem.barcode,
      status: entry.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      ...(reasons.length > 0 ? { failureReasons: reasons } : {}),
    };
  });

  return { processing, items };
}
