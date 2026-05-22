/**
 * Unit tests for captureCostSnapshot.
 *
 * All external I/O (Prisma tx) is mocked via vi.fn(). No DB required.
 * Per spec §5.2 + §5.8 edge cases.
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { captureCostSnapshot, SnapshotAlreadyCapturedError } from '../cost-snapshot.service';

// ─── Mock factory helpers ────────────────────────────────────────────────────

const BASE_ITEM = {
  id: 'item-1',
  orderId: 'order-1',
  organizationId: 'org-1',
  productVariantId: 'variant-1',
  quantity: 2,
  unitPrice: new Decimal('200.00'),
  commissionRate: new Decimal('10.00'),
  commissionAmount: new Decimal('20.00'),
  unitCostSnapshot: null,
  // PR-6 continuation: write-once guard reads unitCostSnapshotNet.
  unitCostSnapshotNet: null,
  unitCostSnapshotVatAmount: null,
  unitCostSnapshotVatRate: null,
  snapshotCapturedAt: null,
  productVariant: { id: 'variant-1' },
};

const TRY_PROFILE = {
  id: 'profile-try',
  organizationId: 'org-1',
  name: 'TRY COGS',
  type: 'COGS' as const,
  amount: new Decimal('50.00'),
  currency: 'TRY' as const,
  vatRate: 0,
  // PR-4: KDV snapshot column. null exercises captureCostSnapshot's
  // defensive compute (canonical formula). vatRate=0 → vatAmount=0 either way.
  vatAmount: null,
  fxRateMode: 'AUTO' as const,
  manualFxRate: null,
  note: null,
  archivedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const USD_PROFILE_AUTO = {
  ...TRY_PROFILE,
  id: 'profile-usd-auto',
  name: 'USD COGS AUTO',
  currency: 'USD' as const,
  amount: new Decimal('10.00'),
};

const USD_PROFILE_MANUAL = {
  ...TRY_PROFILE,
  id: 'profile-usd-manual',
  name: 'USD COGS MANUAL',
  currency: 'USD' as const,
  amount: new Decimal('10.00'),
  fxRateMode: 'MANUAL' as const,
  manualFxRate: new Decimal('35.50'),
};

function makeTx(overrides: {
  item?: object;
  links?: Array<{ profile: object }>;
  fxRow?: object | null;
}) {
  const item = overrides.item ?? BASE_ITEM;
  const links = overrides.links ?? [{ profile: TRY_PROFILE }];
  // Use explicit `in` check so callers can pass fxRow: null to simulate missing rate.
  const fxRow =
    'fxRow' in overrides
      ? overrides.fxRow
      : { rateToTry: new Decimal('45.19'), rateDate: new Date('2026-05-08T00:00:00Z') };

  return {
    orderItem: {
      findUnique: vi.fn().mockResolvedValue(item),
      update: vi.fn().mockResolvedValue({}),
    },
    productVariantCostProfile: {
      findMany: vi.fn().mockResolvedValue(links),
    },
    fxRate: {
      findFirst: vi.fn().mockResolvedValue(fxRow),
    },
    orderItemCostSnapshotComponent: {
      createMany: vi.fn().mockResolvedValue({ count: links.length }),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('captureCostSnapshot', () => {
  it('throws SnapshotAlreadyCapturedError when unitCostSnapshotNet is already set', async () => {
    const tx = makeTx({
      item: { ...BASE_ITEM, unitCostSnapshotNet: new Decimal('100.00') },
    });

    await expect(captureCostSnapshot('item-1', tx as never)).rejects.toThrow(
      SnapshotAlreadyCapturedError,
    );

    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('returns silently without writing when productVariantId is null', async () => {
    const tx = makeTx({
      item: { ...BASE_ITEM, productVariantId: null, productVariant: null },
    });

    await captureCostSnapshot('item-1', tx as never);

    expect(tx.productVariantCostProfile.findMany).not.toHaveBeenCalled();
    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('returns silently without writing when no profiles are attached', async () => {
    const tx = makeTx({ links: [] });

    await captureCostSnapshot('item-1', tx as never);

    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('captures snapshot for all-TRY profiles, rate=1, source=TRY-NATIVE', async () => {
    const tx = makeTx({ links: [{ profile: TRY_PROFILE }] });

    await captureCostSnapshot('item-1', tx as never);

    expect(tx.orderItem.update).toHaveBeenCalledOnce();
    const updateCall = tx.orderItem.update.mock.calls[0]![0];
    expect(updateCall.data.unitCostSnapshotNet.toFixed(2)).toBe('50.00');
    expect(updateCall.data.snapshotCapturedAt).toBeInstanceOf(Date);

    expect(tx.orderItemCostSnapshotComponent.createMany).toHaveBeenCalledOnce();
    const components: Array<{
      fxRateSource: string;
      fxRateUsed: Decimal;
      amountInTry: Decimal;
    }> = tx.orderItemCostSnapshotComponent.createMany.mock.calls[0]![0].data;
    expect(components).toHaveLength(1);
    expect(components[0]!.fxRateSource).toBe('TRY-NATIVE');
    expect(components[0]!.fxRateUsed.toFixed(2)).toBe('1.00');
    expect(components[0]!.amountInTry.toFixed(2)).toBe('50.00');
  });

  it('captures snapshot for USD AUTO profile when FX rate exists', async () => {
    const tx = makeTx({
      links: [{ profile: USD_PROFILE_AUTO }],
      fxRow: {
        rateToTry: new Decimal('45.19'),
        rateDate: new Date('2026-05-08T00:00:00Z'),
      },
    });

    await captureCostSnapshot('item-1', tx as never);

    expect(tx.orderItem.update).toHaveBeenCalledOnce();
    const updateCall = tx.orderItem.update.mock.calls[0]![0];
    // 10.00 USD × 45.19 = 451.90 TRY
    expect(updateCall.data.unitCostSnapshotNet.toFixed(2)).toBe('451.90');

    const components: Array<{
      fxRateSource: string;
      fxRateUsed: Decimal;
    }> = tx.orderItemCostSnapshotComponent.createMany.mock.calls[0]![0].data;
    expect(components[0]!.fxRateSource).toBe('TCMB-2026-05-08');
    expect(components[0]!.fxRateUsed.toFixed(2)).toBe('45.19');
  });

  it('returns silently (snapshot stays null) for USD AUTO when no FX rate exists', async () => {
    const tx = makeTx({
      links: [{ profile: USD_PROFILE_AUTO }],
      fxRow: null,
    });

    await captureCostSnapshot('item-1', tx as never);

    expect(tx.orderItem.update).not.toHaveBeenCalled();
    expect(tx.orderItemCostSnapshotComponent.createMany).not.toHaveBeenCalled();
  });

  it('captures snapshot for USD MANUAL profile, uses profile.manualFxRate', async () => {
    const tx = makeTx({
      links: [{ profile: USD_PROFILE_MANUAL }],
    });

    await captureCostSnapshot('item-1', tx as never);

    expect(tx.orderItem.update).toHaveBeenCalledOnce();
    const updateCall = tx.orderItem.update.mock.calls[0]![0];
    // 10.00 USD × 35.50 = 355.00 TRY
    expect(updateCall.data.unitCostSnapshotNet.toFixed(2)).toBe('355.00');

    const components: Array<{
      fxRateSource: string;
      fxRateUsed: Decimal;
    }> = tx.orderItemCostSnapshotComponent.createMany.mock.calls[0]![0].data;
    expect(components[0]!.fxRateSource).toBe('MANUAL');
    expect(components[0]!.fxRateUsed.toFixed(2)).toBe('35.50');

    // MANUAL mode must not query the fx_rates table
    expect(tx.fxRate.findFirst).not.toHaveBeenCalled();
  });
});
