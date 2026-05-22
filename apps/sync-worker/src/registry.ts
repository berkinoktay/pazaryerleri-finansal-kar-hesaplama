// Maps SyncType → ModuleHandler. Lives in its own module so tests can
// import the production registry without triggering index.ts's top-level
// main() invocation. Every SyncType enum value must appear here — see
// tests/integration/registry-coverage.test.ts which fails when a new
// SyncType is added without a handler binding.

import type { Registry } from './dispatcher';
import { ordersHandler } from './handlers/orders';
import { productsHandler } from './handlers/products';
import { settlementsHandler } from './handlers/settlements/cron';

export const REGISTRY: Registry = {
  PRODUCTS: productsHandler,
  ORDERS: ordersHandler,
  SETTLEMENTS: settlementsHandler,
};
