// Maps SyncType → ModuleHandler. Lives in its own module so tests can
// import the production registry without triggering index.ts's top-level
// main() invocation. Every SyncType enum value must appear here: the
// `satisfies Record<SyncType, ModuleHandler>` makes a missing binding a
// compile error, and tests/integration/registry-coverage.test.ts checks the
// same at runtime over Object.values(SyncType).

import type { SyncType } from '@pazarsync/db';

import { claimsHandler } from './handlers/claims';
import { ordersHandler } from './handlers/orders';
import { productsHandler } from './handlers/products';
import { productsChangesHandler } from './handlers/products-changes';
import { productsDeltaHandler } from './handlers/products-delta';
import { settlementsHandler } from './handlers/settlements/cron';
import type { ModuleHandler } from './handlers/types';

export const REGISTRY = {
  PRODUCTS: productsHandler,
  PRODUCTS_DELTA: productsDeltaHandler,
  PRODUCTS_CHANGES: productsChangesHandler,
  ORDERS: ordersHandler,
  SETTLEMENTS: settlementsHandler,
  CLAIMS: claimsHandler,
} as const satisfies Record<SyncType, ModuleHandler>;
