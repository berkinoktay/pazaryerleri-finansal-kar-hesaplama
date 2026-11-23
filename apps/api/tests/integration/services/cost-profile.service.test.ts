import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import { drainProfitRecomputeQueue, recomputeParcelProfit } from '@pazarsync/profit';

import {
  archiveCostProfile,
  createCostProfile,
  getCostProfile,
  restoreCostProfile,
  updateCostProfile,
} from '@/services/cost-profile.service';

import { CostProfileNameTakenError, CostProfileNotFoundError } from '@/lib/errors';

import { seedCalculableTrendyolOrder } from '../../helpers/calculable-order';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
  createUserProfile,
} from '../../helpers/factories';

const BASE_INPUT = {
  name: 'Hammadde COGS',
  type: 'COGS' as const,
  amountGross: '25.50',
  vatRate: 18,
};

// createCostProfile now requires a storeId — cost profiles are store-scoped.
// Most tests just need SOME store in the org, so this pairs BASE_INPUT with a
// freshly-created store. The (store, name) uniqueness test reuses one input so
// both creates target the same store.
async function makeInput(orgId: string): Promise<Parameters<typeof createCostProfile>[1]> {
  const store = await createStore(orgId);
  return { ...BASE_INPUT, storeId: store.id };
}

describe('cost-profile service', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── createCostProfile ──────────────────────────────────────────────────────

  describe('createCostProfile', () => {
    it('creates profile and seeds version 1 with changedFields: []', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, await makeInput(org.id), user.id);

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe('Hammadde COGS');
      expect(profile.amountGross.toFixed(2)).toBe('25.50');
      expect(profile.organizationId).toBe(org.id);

      // Verify version row was created in the same transaction
      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
      });
      expect(versions).toHaveLength(1);
      expect(versions[0]?.version).toBe(1);
      expect(versions[0]?.changedFields).toEqual([]);
      expect(versions[0]?.changedBy).toBe(user.id);
    });

    it('persists amountGross and vatRate correctly, version row matches', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, await makeInput(org.id), user.id);

      // BASE_INPUT: amountGross 25.50, vatRate 18 (GROSS convention — KDV-dahil)
      expect(profile.amountGross.toFixed(2)).toBe('25.50');
      expect(Number(profile.vatRate)).toBe(18);

      // Version row carries the same gross values
      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
      });
      expect(versions[0]?.amountGross?.toFixed(2)).toBe('25.50');
      expect(Number(versions[0]?.vatRate)).toBe(18);
    });

    it('throws CostProfileNameTakenError on duplicate name within the store', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      // Both creates target the same store, so the (store_id, name) unique
      // constraint collides on the second.
      const input = await makeInput(org.id);
      await createCostProfile(org.id, input, user.id);

      await expect(createCostProfile(org.id, input, user.id)).rejects.toBeInstanceOf(
        CostProfileNameTakenError,
      );
    });

    it('allows the same name in a different store', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      await createMembership(orgA.id, user.id);
      const orgB = await createOrganization();

      await expect(
        createCostProfile(orgA.id, await makeInput(orgA.id), user.id),
      ).resolves.toBeDefined();
      await expect(
        createCostProfile(orgB.id, await makeInput(orgB.id), user.id),
      ).resolves.toBeDefined();
    });
  });

  // ─── updateCostProfile ──────────────────────────────────────────────────────

  describe('updateCostProfile', () => {
    it('appends a version with the correct changedFields diff', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, await makeInput(org.id), user.id);

      const updated = await updateCostProfile(
        org.id,
        profile.id,
        { name: 'Updated COGS', amountGross: '30.00' },
        user.id,
      );

      expect(updated.name).toBe('Updated COGS');
      expect(updated.amountGross.toFixed(2)).toBe('30.00');

      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
        orderBy: { version: 'asc' },
      });
      expect(versions).toHaveLength(2);
      expect(versions[1]?.version).toBe(2);
      expect(versions[1]?.changedFields).toContain('name');
      expect(versions[1]?.changedFields).toContain('amountGross');
      expect(versions[1]?.changedFields).not.toContain('vatRate');
    });

    it('updates amountGross correctly (GROSS convention, KDV-dahil)', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, await makeInput(org.id), user.id);
      const updated = await updateCostProfile(
        org.id,
        profile.id,
        { amountGross: '100.00' },
        user.id,
      );

      // amountGross updated directly — KDV-dahil tutar
      expect(updated.amountGross.toFixed(2)).toBe('100.00');
    });

    it('updates vatRate correctly when changed independently', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, await makeInput(org.id), user.id);
      const updated = await updateCostProfile(org.id, profile.id, { vatRate: 20 }, user.id);

      // vatRate stored as-is; amountGross unchanged
      expect(Number(updated.vatRate)).toBe(20);
      expect(updated.amountGross.toFixed(2)).toBe('25.50');
    });

    it('throws CostProfileNotFoundError for cross-org access', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      await createMembership(orgA.id, user.id);
      const orgB = await createOrganization();

      const profile = await createCostProfile(orgA.id, await makeInput(orgA.id), user.id);

      await expect(
        updateCostProfile(orgB.id, profile.id, { name: 'Hijack' }, user.id),
      ).rejects.toBeInstanceOf(CostProfileNotFoundError);
    });
  });

  // ─── archiveCostProfile ─────────────────────────────────────────────────────

  describe('archiveCostProfile', () => {
    it('sets archivedAt and appends version with changedFields: [archivedAt]', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, await makeInput(org.id), user.id);
      const archived = await archiveCostProfile(org.id, profile.id, user.id);

      expect(archived.archivedAt).not.toBeNull();

      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
        orderBy: { version: 'asc' },
      });
      expect(versions).toHaveLength(2);
      expect(versions[1]?.version).toBe(2);
      expect(versions[1]?.changedFields).toEqual(['archivedAt']);
    });
  });

  // ─── getCostProfile — cross-org isolation ───────────────────────────────────

  describe('getCostProfile', () => {
    it('throws CostProfileNotFoundError for cross-org access (non-disclosure)', async () => {
      const user = await createUserProfile();
      const orgA = await createOrganization();
      await createMembership(orgA.id, user.id);
      const orgB = await createOrganization();

      const profile = await createCostProfile(orgA.id, await makeInput(orgA.id), user.id);

      // Org B should NOT see Org A's profile
      await expect(getCostProfile(orgB.id, profile.id)).rejects.toBeInstanceOf(
        CostProfileNotFoundError,
      );
    });
  });

  // ─── Concurrent update race protection ──────────────────────────────────────

  describe('concurrent updates', () => {
    it('serializes concurrent PATCHes via SELECT FOR UPDATE — version numbers are monotonically increasing', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const profile = await createCostProfile(org.id, await makeInput(org.id), user.id);

      // Fire two concurrent updates. Because the service uses SELECT FOR UPDATE,
      // one will block until the other commits, ensuring both succeed and produce
      // distinct, non-colliding version numbers.
      await Promise.all([
        updateCostProfile(org.id, profile.id, { name: 'Race A' }, user.id),
        updateCostProfile(org.id, profile.id, { vatRate: 20 }, user.id),
      ]);

      const versions = await prisma.costProfileVersion.findMany({
        where: { profileId: profile.id },
        orderBy: { version: 'asc' },
      });

      // Version 1 (create) + 2 updates = 3 total. All version numbers distinct.
      expect(versions).toHaveLength(3);
      const vNums = versions.map((v) => v.version);
      expect(new Set(vNums).size).toBe(3);
      // Monotonically increasing
      expect(vNums[0]).toBeLessThan(vNums[1]!);
      expect(vNums[1]).toBeLessThan(vNums[2]!);
    });
  });

  // ─── profit recompute queueing ──────────────────────────────────────────────

  describe('profit recompute queueing', () => {
    it('queues the non-final orders of the attached variants when a cost profile changes, never a final one', async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      const profile = await createCostProfile(
        org.id,
        { ...BASE_INPUT, storeId: store.id },
        user.id,
      );

      const product = await createProduct(org.id, store.id);
      const variant = await createProductVariant(org.id, store.id, product.id);
      await prisma.productVariantCostProfile.create({
        data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
      });

      // Carries the attached variant, seller inputs still following its day: must be
      // queued on a cost change.
      const order = await createOrder(org.id, store.id);
      await createOrderItem(order.id, org.id, { productVariantId: variant.id });

      // Carries the attached variant too, but the day-close pass made its seller inputs
      // final: a cost change never reaches it, so it is never queued.
      const finalOrder = await createOrder(org.id, store.id, { sellerInputsFinalAt: new Date() });
      await createOrderItem(finalOrder.id, org.id, { productVariantId: variant.id });

      // Carries no attached variant → must stay out of the queue.
      const unrelated = await createOrder(org.id, store.id);
      await createOrderItem(unrelated.id, org.id, { productVariantId: null });

      const requestReason = async (orderId: string): Promise<ProfitRecomputeReason | undefined> =>
        (await prisma.profitRecomputeRequest.findUnique({ where: { orderId } }))?.reason;

      // (1) update
      await updateCostProfile(org.id, profile.id, { amountGross: '40.00' }, user.id);
      expect(await requestReason(order.id)).toBe(ProfitRecomputeReason.COST_CHANGED);
      expect(await requestReason(finalOrder.id)).toBeUndefined();
      expect(await requestReason(unrelated.id)).toBeUndefined();

      // (2) archive — clear the mark first to prove archive re-enqueues.
      await prisma.profitRecomputeRequest.deleteMany({ where: { orderId: order.id } });
      await archiveCostProfile(org.id, profile.id, user.id);
      expect(await requestReason(order.id)).toBe(ProfitRecomputeReason.COST_CHANGED);
      expect(await requestReason(finalOrder.id)).toBeUndefined();

      // (3) restore
      await prisma.profitRecomputeRequest.deleteMany({ where: { orderId: order.id } });
      await restoreCostProfile(org.id, profile.id, user.id);
      expect(await requestReason(order.id)).toBe(ProfitRecomputeReason.COST_CHANGED);
      expect(await requestReason(finalOrder.id)).toBeUndefined();
    });

    // Owner rule (Berkin 2026-11-23): every PATCH appends a version, a name-only one
    // included, so today's order re-pins to it; the amount is unchanged, so are the
    // profit numbers. A final order keeps the version it pinned.
    it("a name-only PATCH re-pins today's order to the new version with unchanged statement totals", async () => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const store = await createStore(org.id);

      // Today's calculable order (marker NULL) and a final twin on the same variant.
      const orderId = await seedCalculableTrendyolOrder(org.id, store.id);
      const item = await prisma.orderItem.findFirstOrThrow({
        where: { organizationId: org.id, orderId },
      });
      const variantId = item.productVariantId;
      if (variantId === null) throw new Error('expected the calculable item to carry a variant');
      const link = await prisma.productVariantCostProfile.findFirstOrThrow({
        where: { organizationId: org.id, productVariantId: variantId },
      });
      const finalOrder = await createOrder(org.id, store.id, {
        status: 'DELIVERED',
        saleGross: '240.00',
        saleVat: '40.00',
        sellerInputsFinalAt: new Date(),
      });
      const finalItem = await prisma.orderItem.create({
        data: {
          orderId: finalOrder.id,
          organizationId: org.id,
          productVariantId: variantId,
          quantity: item.quantity,
          barcode: item.barcode,
          lineListGross: item.lineListGross,
          lineSaleGross: item.lineSaleGross,
          lineSellerDiscountGross: item.lineSellerDiscountGross,
          saleVatRate: item.saleVatRate,
          orderCommissionRatePct: item.orderCommissionRatePct,
        },
      });

      // Both orders capture version 1 and write their statements.
      for (const id of [orderId, finalOrder.id]) {
        await prisma.$transaction(
          (tx) => recomputeParcelProfit(tx, { organizationId: org.id, orderId: id }),
          { maxWait: 15_000, timeout: 30_000 },
        );
      }
      const firstVersion = await prisma.costProfileVersion.findFirstOrThrow({
        where: { organizationId: org.id, profileId: link.profileId, version: 1 },
      });
      const pinnedIds = async (orderItemId: string): Promise<string[]> =>
        (
          await prisma.orderItem.findUniqueOrThrow({
            where: { id: orderItemId },
            select: { snapshotCostProfileVersionIds: true },
          })
        ).snapshotCostProfileVersionIds;
      const netProfits = async (): Promise<{ view: string; netProfit: string | null }[]> =>
        (
          await prisma.orderProfitStatement.findMany({
            where: { organizationId: org.id, orderId },
            orderBy: { view: 'asc' },
          })
        ).map((statement) => ({
          view: statement.view,
          netProfit: statement.netProfit?.toString() ?? null,
        }));
      expect(await pinnedIds(item.id)).toEqual([firstVersion.id]);
      expect(await pinnedIds(finalItem.id)).toEqual([firstVersion.id]);
      const before = await netProfits();
      expect(before).toHaveLength(2);
      for (const statement of before) {
        expect(statement.netProfit).not.toBeNull();
      }

      await updateCostProfile(org.id, link.profileId, { name: 'Renamed COGS' }, user.id);
      await drainProfitRecomputeQueue(prisma, { batchSize: 10 });

      const newVersion = await prisma.costProfileVersion.findFirstOrThrow({
        where: { organizationId: org.id, profileId: link.profileId, version: 2 },
      });
      expect(await pinnedIds(item.id)).toEqual([newVersion.id]);
      expect(await netProfits()).toEqual(before);
      // Control: the final order keeps the version it pinned.
      expect(await pinnedIds(finalItem.id)).toEqual([firstVersion.id]);
    });
  });
});
