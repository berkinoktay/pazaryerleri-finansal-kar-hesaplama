import type { Platform, StoreEnvironment } from '@pazarsync/db';

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
}

export interface MarketplaceAdapterFactory {
  readonly platform: Platform;
  readonly supportedEnvironments: readonly StoreEnvironment[];
  create(params: {
    environment: StoreEnvironment;
    credentials: unknown; // narrowed by the factory via a type guard
  }): MarketplaceAdapter;
}
