import { Decimal } from 'decimal.js';
import { prisma } from '@pazarsync/db';
import { FeeDefinitionNotFoundError, resolveFeeDefinition } from '@pazarsync/profit';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

/**
 * resolveFeeDefinition — FeeScope 'ALL' kapsam çözümü (denetim A, 2026-06-14).
 *
 * Pazaryeri-bağımsız ücretler (stopaj, komisyon KDV) `ALL` kapsamında yaşar;
 * resolver `platform = X VEYA ALL` ile sorgular. Bir spesifik-pazaryeri sorgusu
 * ALL satırını bulmalı; spesifik bir satır varsa onu tercih etmeli.
 */
const AT = new Date('2026-06-01T00:00:00.000Z');

describe('resolveFeeDefinition — FeeScope ALL fallback', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('resolves STOPPAGE from the ALL row for a TRENDYOL query', async () => {
    const def = await resolveFeeDefinition(prisma, {
      platform: 'TRENDYOL',
      feeType: 'STOPPAGE',
      at: AT,
    });
    expect(def.platform).toBe('ALL');
    expect(def.feeType).toBe('STOPPAGE');
  });

  it('resolves COMMISSION_INVOICE from the ALL row (komisyon KDV %20)', async () => {
    const def = await resolveFeeDefinition(prisma, {
      platform: 'TRENDYOL',
      feeType: 'COMMISSION_INVOICE',
      at: AT,
    });
    expect(def.platform).toBe('ALL');
    expect(new Decimal(def.defaultVatRate.toString()).toString()).toBe('20');
  });

  it('resolves a TRENDYOL-specific row (PLATFORM_SERVICE) — ALL does not interfere', async () => {
    const def = await resolveFeeDefinition(prisma, {
      platform: 'TRENDYOL',
      feeType: 'PLATFORM_SERVICE',
      at: AT,
    });
    expect(def.platform).toBe('TRENDYOL');
  });

  it('prefers a specific-platform row over an ALL row for the same feeType (tiebreak)', async () => {
    // Aynı effectiveFrom'da spesifik TRENDYOL STOPPAGE ekle → orderBy platform asc
    // (enum'da TRENDYOL, ALL'dan önce) spesifiki seçer.
    await prisma.feeDefinition.create({
      data: {
        platform: 'TRENDYOL',
        feeType: 'STOPPAGE',
        displayName: 'Stopaj (TRENDYOL override)',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: '0.0200',
        defaultVatRate: '0.00',
        effectiveFrom: new Date('2026-05-18T00:00:00.000Z'),
      },
    });

    const def = await resolveFeeDefinition(prisma, {
      platform: 'TRENDYOL',
      feeType: 'STOPPAGE',
      at: AT,
    });
    expect(def.platform).toBe('TRENDYOL');
    expect(new Decimal(def.rateOfSale?.toString() ?? '0').equals('0.02')).toBe(true);
  });

  it('throws FeeDefinitionNotFoundError when neither specific nor ALL exists', async () => {
    await truncateAll(); // fee_definitions boş — seed yok
    await expect(
      resolveFeeDefinition(prisma, { platform: 'TRENDYOL', feeType: 'COMMISSION_INVOICE', at: AT }),
    ).rejects.toBeInstanceOf(FeeDefinitionNotFoundError);
  });
});
