/**
 * Structural tenant-isolation backstop for the WHOLE org-scoped route surface.
 *
 * Org context is NOT enforced by a mounted middleware — `orgContextMiddleware`
 * exists but is deliberately inline-per-handler (Hono sub-app Variables don't
 * compose with the typed parent context; see apps/api/src/lib/ensure-org-member.ts).
 * That makes tenant isolation an opt-in convention: every `/organizations/{orgId}`
 * handler must remember to call `ensureOrgMember` / `requireCapability` /
 * `requireStoreAccess`. A future route that forgets would serve any authenticated
 * user ANY org's data, and — because Prisma runs as the postgres role and bypasses
 * RLS — nothing else would catch it.
 *
 * This test turns that convention into an enforced invariant: it enumerates every
 * registered org-scoped GET route from the OpenAPI spec and asserts a valid but
 * NON-member caller never receives a 2xx. A new route that ships without its
 * membership guard fails here. (GET only: reads are the data-leak surface and
 * need no request body. Whether a route blocks with 403/404 (membership) or 422
 * (validation), the invariant is the same — a non-member must never get 2xx.)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(
  readFileSync(path.resolve(specDir, '../../../../../packages/api-client/openapi.json'), 'utf8'),
) as { paths: Record<string, Record<string, unknown>> };

// Paths are already `/v1`-prefixed in the spec (basePath is baked in).
const orgScopedGetPaths = Object.entries(spec.paths)
  .filter(([routePath, ops]) => routePath.includes('/organizations/{orgId}') && 'get' in ops)
  .map(([routePath]) => routePath)
  .sort();

describe('Tenant isolation — org-scoped route coverage', () => {
  const app = createApp();
  let nonMemberToken: string;

  beforeAll(async () => {
    await ensureDbReachable();
    // Guard against silent path drift: if the filter matched nothing (spec moved,
    // prefix changed), the it.each below would vacuously pass and the backstop
    // would be dead. The API has dozens of org-scoped GETs.
    expect(orgScopedGetPaths.length).toBeGreaterThan(20);

    // A real, authenticated user who IS a member of their own org — but never of
    // the random target orgs the assertions hit.
    const user = await createAuthenticatedTestUser();
    const ownOrg = await createOrganization();
    await createMembership(ownOrg.id, user.id);
    nonMemberToken = user.accessToken;
  });

  it.each(orgScopedGetPaths)('non-member never gets 2xx: GET %s', async (routePath) => {
    // Substitute a fresh random UUID for every path param (orgId + any storeId /
    // resourceId): the caller is a member of none of these, so the membership
    // guard must reject before any tenant data is read.
    const url = routePath.replace(/\{[^}]+\}/g, () => randomUUID());
    const res = await app.request(url, {
      headers: { Authorization: bearer(nonMemberToken) },
    });
    expect(
      res.status,
      `${routePath} returned ${res.status} (a 2xx) to a non-member — its membership guard is missing`,
    ).toBeGreaterThanOrEqual(400);
  });
});
