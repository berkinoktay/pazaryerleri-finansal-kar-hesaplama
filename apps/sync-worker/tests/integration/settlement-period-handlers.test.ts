// Integration tests for the period-level OrgPeriodFee handlers
// (PR-7 commit 4): PSF / Stoppage / Advertising.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { TrendyolFinancialTransaction } from '@pazarsync/marketplace';

import { handleAdvertising, handlePsf, handleStoppage } from '../../src/handlers/settlements';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

const PAYMENT_ORDER_ID = 57224853;

function makePeriodRow(
  overrides: Partial<TrendyolFinancialTransaction> = {},
): TrendyolFinancialTransaction {
  return {
    id: `tx-${randomUUID().slice(0, 8)}`,
    transactionDate: 1715000000000,
    barcode: null,
    transactionType: 'Platform Hizmet Bedeli',
    receiptId: null,
    description: null,
    debt: 0,
    credit: 0,
    paymentPeriod: null,
    commissionRate: null,
    commissionAmount: null,
    commissionInvoiceSerialNumber: null,
    sellerRevenue: null,
    orderNumber: null,
    paymentOrderId: PAYMENT_ORDER_ID,
    paymentDate: 1715000000000,
    sellerId: 123456,
    storeId: null,
    storeName: null,
    storeAddress: null,
    country: 'Türkiye',
    orderDate: null,
    affiliate: 'TRENDYOLTR',
    shipmentPackageId: null,
    ...overrides,
  };
}

async function buildOrgAndStore(): Promise<{ organizationId: string; storeId: string }> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { organizationId: org.id, storeId: store.id };
}

describe('settlement period-level handlers', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── handlePsf ────────────────────────────────────────────────────────

  describe('handlePsf', () => {
    it('inserts OrgPeriodFee PLATFORM_SERVICE with KDV %20 split', async () => {
      const { organizationId, storeId } = await buildOrgAndStore();
      // PSF invoice 13.19 KDV-dahil → net 10.99, vat 2.20
      const row = makePeriodRow({
        transactionType: 'Platform Hizmet Bedeli',
        debt: 13.19,
        commissionInvoiceSerialNumber: 'DDF2026009472156',
        description: 'Platform Hizmet Bedeli',
      });

      await prisma.$transaction(async (tx) => {
        const result = await handlePsf(storeId, organizationId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orgPeriodFee.findMany({ where: { organizationId } });
      expect(fees).toHaveLength(1);
      expect(fees[0]!.feeType).toBe('PLATFORM_SERVICE');
      expect(fees[0]!.source).toBe('SETTLEMENT');
      expect(fees[0]!.amountNet.toFixed(2)).toBe('10.99');
      expect(fees[0]!.vatRate.toFixed(2)).toBe('20.00');
      expect(fees[0]!.vatAmount.toFixed(2)).toBe('2.20');
      expect(fees[0]!.paymentOrderId).toBe(BigInt(PAYMENT_ORDER_ID));
      expect(fees[0]!.invoiceSerialNumber).toBe('DDF2026009472156');
    });

    it('skips with sparse_field when paymentOrderId is null', async () => {
      const { organizationId, storeId } = await buildOrgAndStore();
      const row = makePeriodRow({ paymentOrderId: null });

      await prisma.$transaction(async (tx) => {
        const result = await handlePsf(storeId, organizationId, row, tx);
        expect(result).toEqual({ applied: false, skipReason: 'sparse_field' });
      });
    });

    it('is idempotent on same Trendyol id', async () => {
      const { organizationId, storeId } = await buildOrgAndStore();
      const row = makePeriodRow({ debt: 13.19 });

      await prisma.$transaction(async (tx) => {
        await handlePsf(storeId, organizationId, row, tx);
      });
      await prisma.$transaction(async (tx) => {
        const result = await handlePsf(storeId, organizationId, row, tx);
        expect(result.applied).toBe(false);
      });

      const fees = await prisma.orgPeriodFee.findMany({ where: { organizationId } });
      expect(fees).toHaveLength(1);
    });
  });

  // ─── handleStoppage ───────────────────────────────────────────────────

  describe('handleStoppage', () => {
    it('inserts OrgPeriodFee STOPPAGE with KDV=0', async () => {
      const { organizationId, storeId } = await buildOrgAndStore();
      const row = makePeriodRow({
        transactionType: 'E-ticaret Stopajı',
        debt: 25.5,
        description: 'İlgili ödeme gününe ilişkin stopaj',
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleStoppage(storeId, organizationId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orgPeriodFee.findMany({ where: { organizationId } });
      expect(fees).toHaveLength(1);
      expect(fees[0]!.feeType).toBe('STOPPAGE');
      expect(fees[0]!.amountNet.toFixed(2)).toBe('25.50');
      expect(fees[0]!.vatRate.toFixed(2)).toBe('0.00');
      expect(fees[0]!.vatAmount.toFixed(2)).toBe('0.00');
    });

    it('inserts two rows for two paymentDate values under the same cycle', async () => {
      const { organizationId, storeId } = await buildOrgAndStore();
      // Two Stoppage rows under the same paymentOrderId but different
      // paymentDate values (research §4.3: bir cycle birden fazla
      // paymentDate içerebilir).
      const week1 = makePeriodRow({
        id: 'stoppage-1',
        debt: 15,
        paymentDate: new Date('2026-05-10T00:00:00Z').getTime(),
      });
      const week2 = makePeriodRow({
        id: 'stoppage-2',
        debt: 20,
        paymentDate: new Date('2026-05-17T00:00:00Z').getTime(),
      });

      await prisma.$transaction(async (tx) => {
        await handleStoppage(storeId, organizationId, week1, tx);
        await handleStoppage(storeId, organizationId, week2, tx);
      });

      const fees = await prisma.orgPeriodFee.findMany({
        where: { organizationId },
        orderBy: { paymentDate: 'asc' },
      });
      expect(fees).toHaveLength(2);
      expect(fees[0]!.amountNet.toFixed(2)).toBe('15.00');
      expect(fees[1]!.amountNet.toFixed(2)).toBe('20.00');
    });
  });

  // ─── handleAdvertising ────────────────────────────────────────────────

  describe('handleAdvertising', () => {
    it('inserts OrgPeriodFee ADVERTISING (V1 flat-zero KDV)', async () => {
      const { organizationId, storeId } = await buildOrgAndStore();
      const row = makePeriodRow({
        transactionType: 'Reklam Bedeli',
        debt: 100,
        description: 'Satıcı Reklamı Satın Alma',
      });

      await prisma.$transaction(async (tx) => {
        const result = await handleAdvertising(storeId, organizationId, row, tx);
        expect(result.applied).toBe(true);
      });

      const fees = await prisma.orgPeriodFee.findMany({ where: { organizationId } });
      expect(fees).toHaveLength(1);
      expect(fees[0]!.feeType).toBe('ADVERTISING');
      // V1 pragmatic — KDV split deferred to commit 9 stage validation.
      expect(fees[0]!.amountNet.toFixed(2)).toBe('100.00');
      expect(fees[0]!.vatRate.toFixed(2)).toBe('0.00');
      expect(fees[0]!.vatAmount.toFixed(2)).toBe('0.00');
    });
  });
});
