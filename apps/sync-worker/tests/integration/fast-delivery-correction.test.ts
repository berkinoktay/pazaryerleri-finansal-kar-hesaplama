// Integration tests for applyFastDeliveryCorrection (PR-7 commit 7).
//
// Verifies:
//   - Eligibility matrix: fastDelivery × onTime × delivery-data presence
//   - CREDIT OrderFee write semantics (₺4.00 net + ₺0.80 KDV)
//   - Idempotency via externalRef.derivedFrom = 'fast-delivery' filter
//   - Boundary: actualDeliveryDate == agreedDeliveryDate is on-time (≤)
//
// Cascade integration is verified end-to-end in payment-order-cascade
// test (commit 5); here we focus on the standalone helper semantics.

import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { applyFastDeliveryCorrection } from '../../src/handlers/settlements';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

interface BuiltOrder {
  storeId: string;
  organizationId: string;
  orderId: string;
}

interface OrderShape {
  fastDelivery: boolean;
  agreedDeliveryDate: Date | null;
  actualDeliveryDate: Date | null;
}

async function buildOrder(opts: OrderShape): Promise<BuiltOrder> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: `pkg-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'DELIVERED',
      fastDelivery: opts.fastDelivery,
      agreedDeliveryDate: opts.agreedDeliveryDate,
      actualDeliveryDate: opts.actualDeliveryDate,
    },
  });

  return { storeId: store.id, organizationId: org.id, orderId: order.id };
}

describe('applyFastDeliveryCorrection', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('writes CREDIT OrderFee when fastDelivery + on-time', async () => {
    const { organizationId, orderId } = await buildOrder({
      fastDelivery: true,
      agreedDeliveryDate: new Date('2026-05-10T12:00:00Z'),
      actualDeliveryDate: new Date('2026-05-10T08:00:00Z'), // earlier than agreed
    });

    await prisma.$transaction(async (tx) => {
      const result = await applyFastDeliveryCorrection(orderId, tx);
      expect(result).toEqual({ applied: true });
    });

    const fees = await prisma.orderFee.findMany({ where: { orderId } });
    expect(fees).toHaveLength(1);
    expect(fees[0]!.feeType).toBe('PLATFORM_SERVICE');
    expect(fees[0]!.direction).toBe('CREDIT');
    expect(fees[0]!.source).toBe('SETTLEMENT');
    expect(fees[0]!.amountNet.toFixed(2)).toBe('4.00');
    expect(fees[0]!.vatAmount.toFixed(2)).toBe('0.80');
    expect(fees[0]!.vatRate.toFixed(2)).toBe('20.00');
    expect(fees[0]!.displayName).toBe('Bugün Kargoda PSF İndirimi');
    expect(fees[0]!.organizationId).toBe(organizationId);
    expect(fees[0]!.externalRef).toMatchObject({ derivedFrom: 'fast-delivery' });
  });

  it('boundary: actualDeliveryDate == agreedDeliveryDate is on-time (≤)', async () => {
    const same = new Date('2026-05-10T12:00:00Z');
    const { orderId } = await buildOrder({
      fastDelivery: true,
      agreedDeliveryDate: same,
      actualDeliveryDate: same,
    });

    await prisma.$transaction(async (tx) => {
      const result = await applyFastDeliveryCorrection(orderId, tx);
      expect(result).toEqual({ applied: true });
    });

    const fees = await prisma.orderFee.findMany({ where: { orderId } });
    expect(fees).toHaveLength(1);
  });

  it('skips when fastDelivery=false', async () => {
    const { orderId } = await buildOrder({
      fastDelivery: false,
      agreedDeliveryDate: new Date('2026-05-10T12:00:00Z'),
      actualDeliveryDate: new Date('2026-05-10T08:00:00Z'),
    });

    await prisma.$transaction(async (tx) => {
      const result = await applyFastDeliveryCorrection(orderId, tx);
      expect(result).toEqual({ applied: false, skipReason: 'not_fast_delivery' });
    });

    const fees = await prisma.orderFee.findMany({ where: { orderId } });
    expect(fees).toHaveLength(0);
  });

  it('skips when delivery was late (actual > agreed)', async () => {
    const { orderId } = await buildOrder({
      fastDelivery: true,
      agreedDeliveryDate: new Date('2026-05-10T12:00:00Z'),
      actualDeliveryDate: new Date('2026-05-11T08:00:00Z'),
    });

    await prisma.$transaction(async (tx) => {
      const result = await applyFastDeliveryCorrection(orderId, tx);
      expect(result).toEqual({ applied: false, skipReason: 'not_on_time' });
    });
  });

  it('skips when actualDeliveryDate is null (not delivered yet)', async () => {
    const { orderId } = await buildOrder({
      fastDelivery: true,
      agreedDeliveryDate: new Date('2026-05-10T12:00:00Z'),
      actualDeliveryDate: null,
    });

    await prisma.$transaction(async (tx) => {
      const result = await applyFastDeliveryCorrection(orderId, tx);
      expect(result).toEqual({ applied: false, skipReason: 'delivery_data_incomplete' });
    });
  });

  it('skips when agreedDeliveryDate is null (data missing)', async () => {
    const { orderId } = await buildOrder({
      fastDelivery: true,
      agreedDeliveryDate: null,
      actualDeliveryDate: new Date('2026-05-10T08:00:00Z'),
    });

    await prisma.$transaction(async (tx) => {
      const result = await applyFastDeliveryCorrection(orderId, tx);
      expect(result).toEqual({ applied: false, skipReason: 'delivery_data_incomplete' });
    });
  });

  it('is idempotent — second run does not duplicate the correction', async () => {
    const { orderId } = await buildOrder({
      fastDelivery: true,
      agreedDeliveryDate: new Date('2026-05-10T12:00:00Z'),
      actualDeliveryDate: new Date('2026-05-10T08:00:00Z'),
    });

    await prisma.$transaction(async (tx) => {
      await applyFastDeliveryCorrection(orderId, tx);
    });
    await prisma.$transaction(async (tx) => {
      const result = await applyFastDeliveryCorrection(orderId, tx);
      expect(result).toEqual({ applied: false, skipReason: 'already_applied' });
    });

    const fees = await prisma.orderFee.findMany({ where: { orderId } });
    expect(fees).toHaveLength(1);
  });

  it('returns order_not_found when orderId does not exist', async () => {
    await prisma.$transaction(async (tx) => {
      const result = await applyFastDeliveryCorrection('00000000-0000-0000-0000-000000000000', tx);
      expect(result).toEqual({ applied: false, skipReason: 'order_not_found' });
    });
  });
});
