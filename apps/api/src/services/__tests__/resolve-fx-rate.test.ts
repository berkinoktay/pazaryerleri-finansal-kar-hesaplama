/**
 * Unit tests for resolveFxRateForSnapshot — table-driven, no DB.
 *
 * The tx parameter is mocked so these run without a real database connection.
 * All four branches from spec §5.3 are covered.
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import type { CostProfile } from '@pazarsync/db';

import { resolveFxRateForSnapshot } from '../fx-rates.service';

// Minimal CostProfile stub — only the fields resolveFxRateForSnapshot reads.
function makeProfile(overrides: Partial<CostProfile>): CostProfile {
  return {
    id: 'profile-id',
    organizationId: 'org-id',
    name: 'Test Profile',
    type: 'COGS',
    amount: new Decimal('100.00'),
    currency: 'TRY',
    vatRate: 0,
    fxRateMode: 'AUTO',
    manualFxRate: null,
    note: null,
    archivedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CostProfile;
}

describe('resolveFxRateForSnapshot', () => {
  it('TRY → rate=1 source=TRY-NATIVE (no DB call)', async () => {
    const tx = { fxRate: { findFirst: vi.fn() } };
    const profile = makeProfile({ currency: 'TRY', fxRateMode: 'AUTO' });

    const result = await resolveFxRateForSnapshot(profile, tx as never);

    expect(result).not.toBeNull();
    expect(result!.rate.toFixed(2)).toBe('1.00');
    expect(result!.source).toBe('TRY-NATIVE');
    expect(tx.fxRate.findFirst).not.toHaveBeenCalled();
  });

  it('MANUAL → uses profile.manualFxRate, source=MANUAL', async () => {
    const tx = { fxRate: { findFirst: vi.fn() } };
    const profile = makeProfile({
      currency: 'USD',
      fxRateMode: 'MANUAL',
      manualFxRate: new Decimal('35.50'),
    });

    const result = await resolveFxRateForSnapshot(profile, tx as never);

    expect(result).not.toBeNull();
    expect(result!.rate.toFixed(2)).toBe('35.50');
    expect(result!.source).toBe('MANUAL');
    expect(tx.fxRate.findFirst).not.toHaveBeenCalled();
  });

  it('AUTO with FX rate in DB → rate from DB, source=TCMB-YYYY-MM-DD', async () => {
    const rateDate = new Date('2026-05-08T00:00:00Z');
    const tx = {
      fxRate: {
        findFirst: vi.fn().mockResolvedValue({
          rateToTry: new Decimal('45.19'),
          rateDate,
        }),
      },
    };
    const profile = makeProfile({ currency: 'USD', fxRateMode: 'AUTO' });

    const result = await resolveFxRateForSnapshot(profile, tx as never);

    expect(result).not.toBeNull();
    expect(result!.rate.toFixed(2)).toBe('45.19');
    expect(result!.source).toBe('TCMB-2026-05-08');
    expect(tx.fxRate.findFirst).toHaveBeenCalledOnce();
  });

  it('AUTO with no FX rate in DB → returns null', async () => {
    const tx = {
      fxRate: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    const profile = makeProfile({ currency: 'EUR', fxRateMode: 'AUTO' });

    const result = await resolveFxRateForSnapshot(profile, tx as never);

    expect(result).toBeNull();
  });
});
