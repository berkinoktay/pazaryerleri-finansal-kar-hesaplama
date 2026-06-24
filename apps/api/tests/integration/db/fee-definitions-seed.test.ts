import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

/**
 * FeeDefinition seed verification (PR-2 + PR-8 + denetim A).
 *
 * FeeScope kapsamıyla (denetim A, 2026-06-14 — pazaryeri-bağımsız ücretler 'ALL'):
 *   TRENDYOL:
 *     - PLATFORM_SERVICE      FIXED 10.99   + KDV %20  (zorunlu)
 *     - PLATFORM_SERVICE_FAST FIXED 6.99    + KDV %20  (opsiyonel — Bugün Kargoda)
 *     - RETURN_SHIPPING       FIXED NULL    + KDV %20  (opsiyonel — cargo-invoice)
 *     - SHIPPING              FIXED NULL    + KDV %20  (opsiyonel — cargo-invoice, PR-8)
 *   ALL (tüm pazaryerlerinde sabit):
 *     - STOPPAGE              RATE  0.0100  + KDV %0   (zorunlu — e-ticaret stopajı)
 *     - COMMISSION_INVOICE    FIXED NULL    + KDV %20  (komisyon KDV oranı, denetim A)
 *
 * effectiveFrom = 2026-05-18, effectiveTo = NULL (açık ucu). 6 satır toplam.
 */
describe('FeeDefinition seed — FeeScope (denetim A)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('contains 5 TRENDYOL + 2 ALL rows (7 total)', async () => {
    // 5 TRENDYOL: PSF, PSF_FAST, RETURN_SHIPPING, SHIPPING, INTERNATIONAL_SERVICE (mikro ihracat).
    // 2 ALL: STOPPAGE, COMMISSION_INVOICE.
    const trendyol = await prisma.feeDefinition.findMany({ where: { platform: 'TRENDYOL' } });
    const all = await prisma.feeDefinition.findMany({ where: { platform: 'ALL' } });
    expect(trendyol).toHaveLength(5);
    expect(all).toHaveLength(2);
  });

  it('SHIPPING row exists (TRENDYOL, amount NULL — runtime from cargo-invoice, PR-8)', async () => {
    const row = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'SHIPPING' },
    });
    expect(row?.calculationKind).toBe('FIXED');
    expect(row?.fixedAmountNet).toBeNull();
    expect(new Decimal(row?.defaultVatRate ?? '0').toString()).toBe('20');
    expect(row?.isRequired).toBe(false);
  });

  it('PLATFORM_SERVICE row has correct values (TRENDYOL)', async () => {
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

  it('PLATFORM_SERVICE_FAST row has correct values (TRENDYOL, Bugün Kargoda)', async () => {
    const row = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'PLATFORM_SERVICE_FAST' },
    });
    expect(row).not.toBeNull();
    expect(row?.calculationKind).toBe('FIXED');
    expect(new Decimal(row?.fixedAmountNet ?? '0').toString()).toBe('6.99');
    expect(new Decimal(row?.defaultVatRate ?? '0').toString()).toBe('20');
    expect(row?.isRequired).toBe(false);
  });

  it('STOPPAGE row is ALL-scoped (rate %1, KDV %0) — denetim A', async () => {
    const row = await prisma.feeDefinition.findFirst({ where: { feeType: 'STOPPAGE' } });
    expect(row?.platform).toBe('ALL');
    expect(row?.calculationKind).toBe('RATE_OF_SALE');
    expect(row?.fixedAmountNet).toBeNull();
    // Decimal(7, 4) → 0.0100; Decimal.toString() yuvarlama 0.01 ya da 0.0100 olabilir
    expect(new Decimal(row?.rateOfSale ?? '0').equals('0.01')).toBe(true);
    expect(new Decimal(row?.defaultVatRate ?? '999').equals('0')).toBe(true);
    expect(row?.isRequired).toBe(true);
    // TRENDYOL kapsamında STOPPAGE OLMAMALI (taşındı).
    const trendyolStoppage = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'STOPPAGE' },
    });
    expect(trendyolStoppage).toBeNull();
  });

  it('COMMISSION_INVOICE row is ALL-scoped (komisyon KDV oranı %20) — denetim A', async () => {
    const row = await prisma.feeDefinition.findFirst({ where: { feeType: 'COMMISSION_INVOICE' } });
    expect(row?.platform).toBe('ALL');
    expect(row?.calculationKind).toBe('FIXED');
    // Tutar taşımaz — yalnız KDV oranı (default_vat_rate) okunur.
    expect(row?.fixedAmountNet).toBeNull();
    expect(row?.rateOfSale).toBeNull();
    expect(new Decimal(row?.defaultVatRate ?? '0').toString()).toBe('20');
    expect(row?.isRequired).toBe(false);
  });

  it('RETURN_SHIPPING row exists (TRENDYOL, amount NULL — runtime from cargo-invoice)', async () => {
    const row = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'RETURN_SHIPPING' },
    });
    expect(row).not.toBeNull();
    expect(row?.calculationKind).toBe('FIXED');
    expect(row?.fixedAmountNet).toBeNull();
    expect(new Decimal(row?.defaultVatRate ?? '0').toString()).toBe('20');
    expect(row?.isRequired).toBe(false);
  });

  it('INTERNATIONAL_SERVICE row exists (TRENDYOL, mikro ihracat — %6 RATE_OF_SALE)', async () => {
    const row = await prisma.feeDefinition.findFirst({
      where: { platform: 'TRENDYOL', feeType: 'INTERNATIONAL_SERVICE' },
    });
    expect(row).not.toBeNull();
    expect(row?.calculationKind).toBe('RATE_OF_SALE');
    expect(new Decimal(row?.rateOfSale ?? '0').toString()).toBe('0.06');
    expect(new Decimal(row?.defaultVatRate ?? '0').toString()).toBe('20');
    expect(row?.isRequired).toBe(true);
    // Trendyol mikro ihracat Uluslararası Hizmet Bedeli 16.07.2024'te yürürlüğe girdi.
    expect(row?.effectiveFrom.toISOString().startsWith('2024-07-16')).toBe(true);
  });

  it('seed is idempotent — re-running does not duplicate rows', async () => {
    await ensureFeeDefinitions();
    await ensureFeeDefinitions();
    const all = await prisma.feeDefinition.findMany();
    expect(all).toHaveLength(7);
  });

  it('every seed row has its documented effectiveFrom and an open effectiveTo', async () => {
    const rows = await prisma.feeDefinition.findMany();
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      // Mikro ihracat Uluslararası Hizmet Bedeli 2024-07-16; diğer tüm ücretler 2026-05-18.
      const expectedFrom = row.feeType === 'INTERNATIONAL_SERVICE' ? '2024-07-16' : '2026-05-18';
      expect(row.effectiveFrom.toISOString().startsWith(expectedFrom)).toBe(true);
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
