import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ensureDbReachable, truncateAll, prisma } from '../../helpers/db';
import { createOrganization, createStore, createOrder } from '../../helpers/factories';

describe('Data-layer tenant isolation', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("prisma.order.findMany filtered by organizationId returns only that org's orders", async () => {
    const orgA = await createOrganization({ name: 'Org A', slug: 'org-a' });
    const orgB = await createOrganization({ name: 'Org B', slug: 'org-b' });

    const storeA = await createStore(orgA.id);
    await createOrder(orgA.id, storeA.id, { totalAmount: '150.00' });

    // Sanity: Org A sees its own order
    const ordersForOrgA = await prisma.order.findMany({
      where: { organizationId: orgA.id },
    });
    expect(ordersForOrgA).toHaveLength(1);
    expect(ordersForOrgA[0]?.totalAmount.toString()).toBe('150');

    // CRITICAL: Org B sees nothing — Org A's order does not leak
    const ordersForOrgB = await prisma.order.findMany({
      where: { organizationId: orgB.id },
    });
    expect(ordersForOrgB).toEqual([]);
  });

  it('prisma.store.findMany respects org scope', async () => {
    const orgA = await createOrganization({ slug: 'iso-a' });
    const orgB = await createOrganization({ slug: 'iso-b' });
    await createStore(orgA.id, { name: "A's Store" });
    await createStore(orgB.id, { name: "B's Store" });

    const storesForOrgA = await prisma.store.findMany({
      where: { organizationId: orgA.id },
    });
    expect(storesForOrgA.map((s) => s.name)).toEqual(["A's Store"]);

    const storesForOrgB = await prisma.store.findMany({
      where: { organizationId: orgB.id },
    });
    expect(storesForOrgB.map((s) => s.name)).toEqual(["B's Store"]);
  });
});
