// vitest setupFile for integration suites (wired by configureWorkerDatabases).
// Runs inside each worker BEFORE the test file is imported, so the Prisma
// singleton (packages/db/src/index.ts reads DATABASE_URL at import time) and any
// hand-built pg Pool bind to this worker's private clone of the template DB.
// Dependency-free on purpose: importing Prisma here would defeat that ordering.
import { TEST_BASE_URL_ENV, TEST_DB_PREFIX_ENV, workerDatabaseUrl } from './test-env';

const baseUrl = process.env[TEST_BASE_URL_ENV];
const prefix = process.env[TEST_DB_PREFIX_ENV];
const poolId = process.env['VITEST_POOL_ID'];

if (baseUrl === undefined || prefix === undefined || poolId === undefined) {
  throw new Error(
    `test-worker-env: ${TEST_BASE_URL_ENV}, ${TEST_DB_PREFIX_ENV} and VITEST_POOL_ID must all be set. ` +
      'Wire the config with configureWorkerDatabases() from @pazarsync/db/test-env.',
  );
}

const workerUrl = workerDatabaseUrl(baseUrl, prefix, poolId);
process.env['DATABASE_URL'] = workerUrl;
process.env['DIRECT_URL'] = workerUrl;
