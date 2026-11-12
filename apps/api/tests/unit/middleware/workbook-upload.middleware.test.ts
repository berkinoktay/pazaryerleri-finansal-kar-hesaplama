import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { MemberRole, Store } from '@pazarsync/db';
import {
  MemberRole as MemberRoleValues,
  Platform,
  ShippingTariffSource,
  StoreEnvironment,
  StoreStatus,
} from '@pazarsync/db/enums';

import { ForbiddenError } from '@/lib/errors';
import {
  requireStoreAccessContext,
  type StoreAccessVariables,
} from '@/middleware/workbook-upload.middleware';

// Lower-case hex letters on purpose, the way Postgres returns uuids, so the
// upper-case spelling of each id is a different string.
const ORG_ID = 'aaaaaaaa-1111-4111-8111-11111111111a';
const STORE_ID = 'bbbbbbbb-2222-4222-8222-22222222222b';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

function storeRow(): Store {
  const at = new Date();
  return {
    id: STORE_ID,
    organizationId: ORG_ID,
    name: 'Guard Store',
    platform: Platform.TRENDYOL,
    environment: StoreEnvironment.PRODUCTION,
    externalAccountId: 'seller-1',
    credentials: {},
    status: StoreStatus.ACTIVE,
    isActive: true,
    lastConnectedAt: null,
    lastSyncAt: null,
    shippingTariffSource: ShippingTariffSource.TRENDYOL_CONTRACT,
    defaultShippingCarrierId: null,
    profitSettings: {},
    webhookId: null,
    webhookSecret: null,
    webhookActiveAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * Runs `requireStoreAccessContext` inside a real Hono request so it reads a real
 * context; `access` is what the store-access middleware would have recorded.
 * Returns the helper's result, or the error it threw.
 */
async function runGuard(
  access: { store: Store; role: MemberRole } | undefined,
  orgId: string,
  storeId: string,
): Promise<unknown> {
  let outcome: unknown;
  const app = new Hono<{ Variables: StoreAccessVariables }>();
  app.get('/', (c) => {
    if (access !== undefined) c.set('storeAccess', access);
    try {
      outcome = requireStoreAccessContext(c, orgId, storeId);
    } catch (err) {
      outcome = err;
    }
    return c.body(null, 204);
  });
  await app.request('/');
  return outcome;
}

describe('requireStoreAccessContext', () => {
  it('throws ForbiddenError when the middleware recorded no access', async () => {
    const outcome = await runGuard(undefined, ORG_ID, STORE_ID);
    expect(outcome).toBeInstanceOf(ForbiddenError);
  });

  it('throws ForbiddenError when the recorded store is a different store', async () => {
    const access = { store: storeRow(), role: MemberRoleValues.OWNER };
    const outcome = await runGuard(access, ORG_ID, OTHER_ID);
    expect(outcome).toBeInstanceOf(ForbiddenError);
  });

  it('throws ForbiddenError when the recorded store belongs to a different organization', async () => {
    const access = { store: storeRow(), role: MemberRoleValues.OWNER };
    const outcome = await runGuard(access, OTHER_ID, STORE_ID);
    expect(outcome).toBeInstanceOf(ForbiddenError);
  });

  it('returns the recorded access when it matches the path', async () => {
    const access = { store: storeRow(), role: MemberRoleValues.ADMIN };
    const outcome = await runGuard(access, ORG_ID, STORE_ID);
    expect(outcome).toEqual(access);
  });

  // The path schemas accept an upper-case UUID while Postgres returns ids in lower
  // case, so the same store spelled in upper case must still match its record.
  it('returns the recorded access when the path ids are upper-case spellings of the record ids', async () => {
    const orgIdUpper = ORG_ID.toUpperCase();
    const storeIdUpper = STORE_ID.toUpperCase();
    expect(orgIdUpper).not.toBe(ORG_ID);
    expect(storeIdUpper).not.toBe(STORE_ID);

    const access = { store: storeRow(), role: MemberRoleValues.ADMIN };
    const outcome = await runGuard(access, orgIdUpper, storeIdUpper);
    expect(outcome).toEqual(access);
  });
});
