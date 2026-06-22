import type { Platform, StoreEnvironment } from '@pazarsync/db';

export interface PriceUpdateItem {
  /** Variant barcode — Trendyol price endpoint works on barcode, not variantId. */
  barcode: string;
  /** KDV-dahil sale price as a decimal string (maps to Trendyol `buyingPrice`). */
  salePrice: string;
  /** List price as a decimal string (maps to Trendyol `rrp`). Optional; if provided must be >= salePrice. */
  listPrice?: string;
}

export interface PriceBatchItem {
  barcode: string;
  status: 'SUCCESS' | 'FAILED';
  failureReasons?: string[];
}

/**
 * Common interface every marketplace adapter implements. Phase 1 only
 * exposes testConnection — sync methods (orders / products / settlements)
 * land with their respective phases and extend this interface then.
 */
export interface MarketplaceAdapter {
  /**
   * Verify the credentials work against the configured environment.
   *
   * On failure, throws one of the closed-vocabulary domain errors from
   * `apps/api/src/lib/errors.ts`:
   *   - MarketplaceAuthError     → credentials rejected by vendor
   *   - MarketplaceAccessError   → env allowed, access denied (e.g. sandbox IP whitelist missing)
   *   - MarketplaceUnreachable   → network / 5xx / timeout
   *   - RateLimitedError         → vendor rate limit hit
   *
   * On success, returns the vendor-supplied externalAccountId so the
   * caller can persist it unencrypted.
   */
  testConnection(): Promise<{ externalAccountId: string }>;

  /**
   * Submit a batch price update to the marketplace.
   *
   * Items must include barcode + salePrice (KDV-dahil decimal string);
   * listPrice is optional but must be >= salePrice if provided.
   *
   * Returns a batchId that can be polled via checkPriceBatch. The
   * update is asynchronous — success at submit time means the request
   * was accepted, NOT that prices are live. Per-item outcome requires polling.
   *
   * On failure, throws one of the closed-vocabulary domain errors.
   */
  updatePrices(items: PriceUpdateItem[]): Promise<{ batchId: string }>;

  /**
   * Poll the status of a previously submitted price update batch.
   *
   * `processing: true` means the batch is still in progress (caller should
   * poll again). `processing: false` means the batch is done (COMPLETED or
   * FAILED at the batch level). Per-item outcome is in `items[]`.
   *
   * On failure, throws one of the closed-vocabulary domain errors.
   */
  checkPriceBatch(batchId: string): Promise<{
    processing: boolean;
    items: PriceBatchItem[];
  }>;
}

export interface MarketplaceAdapterFactory {
  readonly platform: Platform;
  readonly supportedEnvironments: readonly StoreEnvironment[];
  create(params: {
    environment: StoreEnvironment;
    credentials: unknown; // narrowed by the factory via a type guard
  }): MarketplaceAdapter;
}
