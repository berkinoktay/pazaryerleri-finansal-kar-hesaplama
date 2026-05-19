import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createCommissionInvoice,
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * commission_invoices: org-scoped via denormalized organization_id.
 * Trendyol haftalık komisyon faturası aggregate (design §3.8). PR-3'te
 * OrderItem.commissionInvoiceId FK eklenip backfill akışı tamamlanır.
 */
describe('RLS — commission_invoices', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only CommissionInvoice rows from own org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    const [invoiceA] = await Promise.all([
      createCommissionInvoice(orgA.id, storeA.id),
      createCommissionInvoice(orgB.id, storeB.id),
    ]);

    const { data, error } = await client
      .from('commission_invoices')
      .select('id,trendyol_serial_number');

    expect(error).toBeNull();
    expect(data?.map((i) => i.id)).toEqual([invoiceA.id]);
  });
});
