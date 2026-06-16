import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { recomputeSettledProfit } from '@pazarsync/profit';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createOrder,
  createOrderFee,
  createOrganization,
  createStore,
} from '../../helpers/factories';

/**
 * design 2026-06-13 §4 — çift-sayım önleme:
 * SHIPPING ESTIMATE fee (CONFIRMABLE_FEE_TYPES dışı, confirmedAt null) settled
 * kâra GİRMEZ; yalnız gerçek CARGO_INVOICE settled'ı besler. Tahmini-kargo ile
 * gerçek-kargo aynı anda dururken bile settled tek kargoyu sayar.
 */
describe('settled profit: no shipping double-count', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('counts only CARGO_INVOICE shipping, never the unconfirmed ESTIMATE shipping fee', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    const order = await createOrder(org.id, store.id, {
      saleGross: '100.00',
      saleVat: '0.00',
    });
    // Cost + commission = 0 (snapshot DOLU → recompute skip etmez). Snapshot'ın
    // DOLU sayılması için hem gross hem vatRate non-null olmalı (recompute gate).
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: org.id,
        quantity: 1,
        commissionRate: '0',
        commissionGross: '0',
        unitCostSnapshotGross: '0',
        unitCostSnapshotVatRate: '0',
      },
    });
    // Tahmini kargo (settled'a girmemeli) + gerçek fatura kargosu (settled'a girer).
    // amountGross = KDV-dahil; vatRate 0 → net = gross.
    await createOrderFee(order.id, org.id, {
      feeType: 'SHIPPING',
      source: 'ESTIMATE',
      direction: 'DEBIT',
      amountGross: '30.00',
      vatRate: '0',
    });
    await createOrderFee(order.id, org.id, {
      feeType: 'SHIPPING',
      source: 'CARGO_INVOICE',
      direction: 'DEBIT',
      amountGross: '50.00',
      vatRate: '0',
    });

    const result = await prisma.$transaction((tx) => recomputeSettledProfit(order.id, tx));
    expect(result.recomputed).toBe(true);

    // settled = 100 − cost 0 − commission 0 − CARGO_INVOICE 50 = 50.
    // (ESTIMATE 30 HARİÇ; dahil olsaydı 20 çıkardı.)
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(new Decimal(updated.settledNetProfit!).toString()).toBe('50');
    // settledNetVat de recompute tarafından persist edildi (writer'ı pinler).
    expect(updated.settledNetVat).not.toBeNull();
  });
});
