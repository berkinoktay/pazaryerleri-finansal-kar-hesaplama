import type { Platform, StoreEnvironment } from '@pazarsync/db';
import { ValidationError } from '@pazarsync/sync-core';

import { trendyolFactory } from './trendyol/adapter';
import type { MarketplaceAdapter, MarketplaceAdapterFactory } from './types';

/**
 * Partial<Record> — Hepsiburada is intentionally absent. The route layer
 * rejects `platform: HEPSIBURADA` with PLATFORM_NOT_YET_AVAILABLE before
 * the registry is consulted. When the Hepsiburada phase lands, register
 * its factory here; zero changes to Trendyol code required.
 */
const FACTORIES: Partial<Record<Platform, MarketplaceAdapterFactory>> = {
  TRENDYOL: trendyolFactory,
};

export function getAdapter(
  platform: Platform,
  environment: StoreEnvironment,
  credentials: unknown,
): MarketplaceAdapter {
  const factory = FACTORIES[platform];
  if (factory === undefined) {
    // Defense-in-depth: the route-level check should have caught this first.
    throw new ValidationError([{ field: 'platform', code: 'PLATFORM_NOT_YET_AVAILABLE' }]);
  }
  if (!factory.supportedEnvironments.includes(environment)) {
    throw new ValidationError([{ field: 'environment', code: 'ENVIRONMENT_NOT_SUPPORTED' }]);
  }
  return factory.create({ environment, credentials });
}
