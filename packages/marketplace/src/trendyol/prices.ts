// Trendyol Price Update API — pure HTTP layer.
//
// Source-of-truth:
//   docs/integrations/trendyol/9-trendyol-ihracat-merkezi-entegrasyonu/
//     fiyat-entegrasyonu.md                             (POST .../prices)
//     urun-stok-fiyat-islemleri-sonuc-entegrasyonu-    (GET .../check-status)
//     batch-id-sorgulama.md
//
// Endpoints (grounding §1.1, §1.2):
//   POST PROD:  https://apigw.trendyol.com/integration/ecgw/v1/{sellerId}/prices
//   POST STAGE: https://stageapigw.trendyol.com/integration/ecgw/v1/{sellerId}/prices
//   GET  PROD:  https://apigw.trendyol.com/integration/ecgw/v1/{sellerId}/check-status?batchId={batchId}
//   GET  STAGE: https://stageapigw.trendyol.com/integration/ecgw/v1/{sellerId}/check-status?batchId={batchId}
//
// Trendyol fiyat yazması ASENKRON: POST → batchId; sonuç check-status ile yoklanır.
// Barkod başına günde 1 fiyat güncellemesi; yanlış fiyat geri alınamaz.

import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable, ValidationError } from '@pazarsync/sync-core';
import Decimal from 'decimal.js';

import type { PriceBatchItem, PriceUpdateItem } from '../types';
import { mapTrendyolResponseToDomainError } from './errors';
import { baseUrlFor, buildAuthHeader, buildUserAgent } from './headers';
import type { TrendyolCredentials } from './types';

const PLATFORM = 'TRENDYOL';
const TIMEOUT_MS = 30_000;

/** Trendyol's documented per-request item limit for price updates (§1.1). */
export const MAX_PRICES_PER_REQUEST = 5_000;

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

interface TrendyolPriceInfo {
  barcode: string;
  /** KDV-dahil satış fiyatı (Trendyol perspektifinden "buyingPrice"). */
  buyingPrice: number;
  /** Tavsiye edilen liste fiyatı (opsiyonel; >= buyingPrice zorunlu). */
  rrp?: number;
}

interface TrendyolPriceUpdateBody {
  priceInfos: TrendyolPriceInfo[];
}

interface TrendyolPriceUpdateResponse {
  batchId: string;
}

interface TrendyolBatchStatusItem {
  requestItem: {
    barcode: string;
    buyingPrice: number;
    rrp?: number;
  };
  status: string;
  failureReasons: string[];
}

interface TrendyolBatchStatusResponse {
  batchId: string;
  batchType: string;
  /** Batch-level status: "COMPLETED" | "IN_PROGRESS" | "FAILED". */
  status: string;
  items: TrendyolBatchStatusItem[];
  creationDate: number;
  lastModification: number;
  itemCount: number;
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

function toPriceInfo(item: PriceUpdateItem): TrendyolPriceInfo {
  const info: TrendyolPriceInfo = {
    barcode: item.barcode,
    // Decimal → number for the Trendyol wire format. Money precision is
    // maintained as a decimal string throughout the domain layer; only at
    // the HTTP boundary do we convert to number (Trendyol's JSON schema
    // uses numeric literals, not strings).
    buyingPrice: new Decimal(item.salePrice).toNumber(),
  };
  if (item.listPrice !== undefined) {
    info.rrp = new Decimal(item.listPrice).toNumber();
  }
  return info;
}

// ─── HTTP functions ──────────────────────────────────────────────────────────

/**
 * POST .../prices — submit a batch price update.
 *
 * Returns `{ batchId }` immediately; the batch processes asynchronously.
 * Per-item success/failure is only known after polling checkPriceBatchStatus.
 *
 * Grounding §1.1: POST /integration/ecgw/v1/{sellerId}/prices
 * Rate limit: UNLIMITED (grounding §1.3).
 */
export async function updatePrices(opts: UpdatePricesOpts): Promise<{ batchId: string }> {
  validateItems(opts.items);

  const base = baseUrlFor(opts.environment);
  const url = `${base}/integration/ecgw/v1/${opts.credentials.supplierId}/prices`;

  const body: TrendyolPriceUpdateBody = {
    priceInfos: opts.items.map(toPriceInfo),
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
  if (typeof parsed.batchId !== 'string' || parsed.batchId.length === 0) {
    throw new MarketplaceUnreachable(PLATFORM, {
      httpStatus: res.status,
      responseBodySnippet: `batchId missing in response: ${JSON.stringify(parsed).slice(0, 256)}`,
    });
  }

  return { batchId: parsed.batchId };
}

/**
 * GET .../check-status?batchId={batchId} — poll the outcome of a batch.
 *
 * `processing: true` when batch-level status is "IN_PROGRESS".
 * `processing: false` when "COMPLETED" or "FAILED" (per-item status is definitive).
 *
 * Grounding §1.2: GET /integration/ecgw/v1/{sellerId}/check-status?batchId=
 * Rate limit: 1000 req/min (grounding §1.3).
 */
export async function checkPriceBatchStatus(opts: CheckPriceBatchOpts): Promise<{
  processing: boolean;
  items: PriceBatchItem[];
}> {
  const base = baseUrlFor(opts.environment);
  const url = new URL(`${base}/integration/ecgw/v1/${opts.credentials.supplierId}/check-status`);
  url.searchParams.set('batchId', opts.batchId);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
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

  const parsed = (await res.json()) as TrendyolBatchStatusResponse;

  const processing = parsed.status === 'IN_PROGRESS';

  const items: PriceBatchItem[] = (parsed.items ?? []).map(
    (entry): PriceBatchItem => ({
      barcode: entry.requestItem.barcode,
      status: entry.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      ...(entry.failureReasons.length > 0 ? { failureReasons: entry.failureReasons } : {}),
    }),
  );

  return { processing, items };
}
