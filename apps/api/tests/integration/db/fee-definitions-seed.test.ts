import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

/**
 * Trendyol FeeDefinition seed verification (PR-2).
 *
 * Design §3.4 — 4 satır V1 başlangıç için:
 *   - PLATFORM_SERVICE      FIXED 10.99   + KDV %20  (zorunlu)
 *   - PLATFORM_SERVICE_FAST FIXED 6.99    + KDV %20  (opsiyonel — Bugün Kargoda)
 *   - STOPPAGE              RATE  0.0100  + KDV %0   (zorunlu)
 *   - RETURN_SHIPPING       FIXED NULL    + KDV %20  (opsiyonel — cargo-invoice)
 *
 * effectiveFrom = 2026-05-18, effectiveTo = NULL (açık ucu).
 */
describe('FeeDefinition seed — Trendyol V1', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('contains exactly 4 Trendyol rows', async () => {
    const rows = await prisma.feeDefinition.findMany({ where: { platform: 'TRENDYOL' } });
    expect(rows).toHaveLength(4);
  });

  it('PLATFORM_SERVICE row has correct values', async () => {
    const row = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE' },
    });
    expect(row).not.toBeNull();
    expect(row?.calculationKind).toBe('FIXED');
    expect(new Decimal(row?.fixedAmountNet ?? '0').toString()).toBe('10.99');
    expect(row?.rateOfSale).toBeNull();
    expect(new Decimal(row?.defaultVatRate ?? '0').toString()).toBe('20');
    expect(row?.isRequired).toBe(true);
  });

  it('PLATFORM_SERVICE_FAST row has correct values (Bugün Kargoda)', async () => {
    const row = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE_FAST' },
    });
    expect(row).not.toBeNull();
    expect(row?.calculationKind).toBe('FIXED');
    expect(new Decimal(row?.fixedAmountNet ?? '0').toString()).toBe('6.99');
    expect(new Decimal(row?.defaultVatRate ?? '0').toString()).toBe('20');
    expect(row?.isRequired).toBe(false);
  });

  it('STOPPAGE row has correct values (rate %1, KDV %0)', async () => {
    const row = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'STOPPAGE' },
    });
    expect(row).not.toBeNull();
    expect(row?.calculationKind).toBe('RATE_OF_SALE');
    expect(row?.fixedAmountNet).toBeNull();
    // Decimal(7, 4) → 0.0100; Decimal.toString() yuvarlama 0.01 ya da 0.0100 olabilir
    expect(new Decimal(row?.rateOfSale ?? '0').equals('0.01')).toBe(true);
    expect(new Decimal(row?.defaultVatRate ?? '999').equals('0')).toBe(true);
    expect(row?.isRequired).toBe(true);
  });

  it('RETURN_SHIPPING row exists (amount NULL — runtime from cargo-invoice)', async () => {
    const row = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'RETURN_SHIPPING' },
    });
    expect(row).not.toBeNull();
    expect(row?.calculationKind).toBe('FIXED');
    expect(row?.fixedAmountNet).toBeNull();
    expect(new Decimal(row?.defaultVatRate ?? '0').toString()).toBe('20');
    expect(row?.isRequired).toBe(false);
  });

  it('seed is idempotent — re-running does not duplicate rows', async () => {
    await ensureFeeDefinitions();
    await ensureFeeDefinitions();
    const rows = await prisma.feeDefinition.findMany({ where: { platform: 'TRENDYOL' } });
    expect(rows).toHaveLength(4);
  });

  it('effectiveFrom is set to 2026-05-18 for all seed rows', async () => {
    const rows = await prisma.feeDefinition.findMany({ where: { platform: 'TRENDYOL' } });
    for (const row of rows) {
      expect(row.effectiveFrom.toISOString().startsWith('2026-05-18')).toBe(true);
      expect(row.effectiveTo).toBeNull();
    }
  });

  it('unique constraint blocks duplicate (platform, fee_type, effective_from)', async () => {
    await expect(
      prisma.feeDefinition.create({
        data: {
          platform: 'TRENDYOL',
          feeType: 'PLATFORM_SERVICE',
          displayName: 'Duplicate',
          calculationKind: 'FIXED',
          fixedAmountNet: '99.99',
          defaultVatRate: '20.00',
          effectiveFrom: new Date('2026-05-18'),
        },
      }),
    ).rejects.toThrow();
  });
});
