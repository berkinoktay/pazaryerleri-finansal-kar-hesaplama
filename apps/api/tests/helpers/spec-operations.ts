// The operations the committed OpenAPI spec registers under one store-scoped segment, as
// "<METHOD> <templated path>" keys. A tenant-isolation file compares them with the
// operations it covers, so a new route of its segment without an isolation case fails
// there: the structural backstop (org-scoped-route-coverage.test.ts) covers GET only.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from '@hono/zod-openapi';

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.resolve(here, '../../../../packages/api-client/openapi.json');

/** The store-scoped prefix every segment hangs off, as the spec writes it. */
const STORE_SCOPED_PREFIX = '/v1/organizations/{orgId}/stores/{storeId}/';

// The keys of a path item that name an operation; `parameters`, `summary` and the
// like are not operations.
const HTTP_METHODS: ReadonlySet<string> = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

const SpecPathsSchema = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});

let specPaths: z.infer<typeof SpecPathsSchema>['paths'] | undefined;

/** The spec's `paths`, read and parsed once per test file. */
function readSpecPaths(): z.infer<typeof SpecPathsSchema>['paths'] {
  if (specPaths === undefined) {
    const spec: unknown = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
    specPaths = SpecPathsSchema.parse(spec).paths;
  }
  return specPaths;
}

/**
 * The sorted "<METHOD> <path>" keys of every operation whose path is
 * `/v1/organizations/{orgId}/stores/{storeId}/<segment>` or lies under it. The match is
 * anchored on the whole segment, so `commission-tariffs` never matches
 * `plus-commission-tariffs`.
 */
export function registeredStoreOperations(segment: string): string[] {
  const base = `${STORE_SCOPED_PREFIX}${segment}`;
  return Object.entries(readSpecPaths())
    .filter(([routePath]) => routePath === base || routePath.startsWith(`${base}/`))
    .flatMap(([routePath, operations]) =>
      Object.keys(operations)
        .filter((method) => HTTP_METHODS.has(method))
        .map((method) => `${method.toUpperCase()} ${routePath}`),
    )
    .sort();
}
