// #297 DB-level fee idempotency guards.
//
// The settlement/cargo handlers each pre-check before insert; these tests
// deliberately BYPASS the handlers and write straight through Prisma to
// prove the partial unique indexes (check-constraints.sql + the
// order_fee_idempotency_columns migration) make a double write impossible
// at the schema layer. Scope note: #291 was the UNDER-write half (missing
// legs) and is healed by the per-leg re-poll in return.ts — a unique index
// cannot catch a missing write. These guards close the complementary
// DOUBLE-write half that until now relied on code discipline alone (e.g.
// a racing 6h re-poll re-inserting the same leg → instant 23505).
//
// Requires `pnpm db:push` (chains apply-policies → check-constraints.sql)
// against the local Supabase before running — same prerequisite as every
// other integration suite.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import {
  createOrder,
  createOrganization,
  createStore,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

/** Prisma maps PG 23505 (unique violation) to P2002. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('code' in err && err.code === 'P2002') return true;
  return err instanceof Error && err.message.includes('23505');
}

async function buildOrder(): Promise<{ orderId: string; organizationId: string; storeId: string }> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  const order = await createOrder(org.id, store.id);
  return { orderId: order.id, organizationId: org.id, storeId: store.id };
}

// GROSS CONVENTION (2026-06-16, Bölüm E Task 20): amountGross + vatRate.
// 10.00 net × 1.20 = 12.00 gross at vatRate=20.
const MONEY = { amountGross: '12.00', vatRate: '20.00' };

describe('order fee unique guards (#297)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('settlement leg: same (order, feeType, trendyolTransactionId) is rejected by the DB', async () => {
    const { orderId, organizationId } = await buildOrder();
    const leg = {
      orderId,
      organizationId,
      feeType: 'REFUND_DEDUCTION',
      source: 'SETTLEMENT',
      direction: 'DEBIT',
      trendyolTransactionId: '725041340',
      ...MONEY,
    } as const;

    await prisma.orderFee.create({ data: leg });

    await expect(prisma.orderFee.create({ data: leg })).rejects.toSatisfy(isUniqueViolation);
  });

  it('settlement trio: same trendyolTransactionId may coexist across feeTypes (legs)', async () => {
    const { orderId, organizationId } = await buildOrder();
    const base = {
      orderId,
      organizationId,
      source: 'SETTLEMENT',
      trendyolTransactionId: '725041340',
      ...MONEY,
    } as const;

    await prisma.orderFee.create({
      data: { ...base, feeType: 'REFUND_DEDUCTION', direction: 'DEBIT' },
    });
    await prisma.orderFee.create({
      data: { ...base, feeType: 'COMMISSION_REFUND', direction: 'CREDIT' },
    });
    await prisma.orderFee.create({
      data: { ...base, feeType: 'COST_RETURN', direction: 'CREDIT' },
    });

    const legs = await prisma.orderFee.count({ where: { orderId } });
    expect(legs).toBe(3);
  });

  it('ESTIMATE rows are unique per (order, feeType) — late re-entry cannot double-book (variant-recovery PR-2)', async () => {
    const { orderId, organizationId } = await buildOrder();
    const estimate = {
      orderId,
      organizationId,
      feeType: 'PLATFORM_SERVICE',
      source: 'ESTIMATE',
      direction: 'DEBIT',
      ...MONEY,
    } as const;

    // #297 left ESTIMATE unconstrained (no identity columns); the estimate
    // re-entry defect (cost arrives late → applyEstimateOnOrderCreate re-runs
    // → 2x PSF/Stopaj → wrong write-once profit) showed that gap is itself a
    // double-write hole. order_fees_estimate_fee_type_uniq now closes it.
    await prisma.orderFee.create({ data: estimate });
    await expect(prisma.orderFee.create({ data: estimate })).rejects.toSatisfy(isUniqueViolation);

    // A DIFFERENT feeType on the same order still lives (PSF + Stopaj pair).
    await prisma.orderFee.create({ data: { ...estimate, feeType: 'STOPPAGE' } });
    const rows = await prisma.orderFee.count({ where: { orderId, source: 'ESTIMATE' } });
    expect(rows).toBe(2);
  });

  it('cargo line: same (order, invoiceSerialNumber, parcelUniqueId) is rejected; a different parcel lives', async () => {
    const { orderId, organizationId } = await buildOrder();
    const line = {
      orderId,
      organizationId,
      feeType: 'SHIPPING',
      source: 'CARGO_INVOICE',
      direction: 'DEBIT',
      invoiceSerialNumber: 'DDF2026013132324',
      parcelUniqueId: '7330032270766345',
      ...MONEY,
    } as const;

    await prisma.orderFee.create({ data: line });

    await expect(prisma.orderFee.create({ data: line })).rejects.toSatisfy(isUniqueViolation);
    // feeType is intentionally NOT part of the cargo key — a reclassified
    // line must dedupe, not double-book (handler comment, cargo-invoice-fees.ts).
    await expect(
      prisma.orderFee.create({ data: { ...line, feeType: 'RETURN_SHIPPING' } }),
    ).rejects.toSatisfy(isUniqueViolation);

    await prisma.orderFee.create({ data: { ...line, parcelUniqueId: '7330032270766999' } });
    const rows = await prisma.orderFee.count({ where: { orderId, source: 'CARGO_INVOICE' } });
    expect(rows).toBe(2);
  });

  it('derived correction: same (order, feeType, derivedFrom) is rejected by the DB', async () => {
    const { orderId, organizationId } = await buildOrder();
    const correction = {
      orderId,
      organizationId,
      feeType: 'PLATFORM_SERVICE',
      source: 'SETTLEMENT',
      direction: 'CREDIT',
      derivedFrom: 'fast-delivery',
      ...MONEY,
    } as const;

    await prisma.orderFee.create({ data: correction });

    await expect(prisma.orderFee.create({ data: correction })).rejects.toSatisfy(isUniqueViolation);
  });

  it('org period fee: same (organization, feeType, trendyolTransactionId) is rejected by the DB', async () => {
    const { organizationId, storeId } = await buildOrder();
    const fee = {
      organizationId,
      storeId,
      paymentOrderId: BigInt(57224853),
      paymentDate: new Date('2026-06-01T00:00:00Z'),
      feeType: 'PLATFORM_SERVICE',
      source: 'SETTLEMENT',
      trendyolTransactionId: 'tx-abc123',
      ...MONEY,
    } as const;

    await prisma.orgPeriodFee.create({ data: fee });

    await expect(prisma.orgPeriodFee.create({ data: fee })).rejects.toSatisfy(isUniqueViolation);
  });
});
