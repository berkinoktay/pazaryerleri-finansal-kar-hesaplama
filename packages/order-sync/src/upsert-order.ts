/**
 * Order/OrderItem write-once upsert + cost snapshot capture + applyEstimate
 * dispatch — single transaction, NEW convention (KDV-split native).
 *
 * Promoted from `apps/sync-worker/src/handlers/orders.ts` (PR-C3a) so that
 * both consumers share one source of truth:
 *   - apps/sync-worker — polling delta sync + initial backfill (PR-B)
 *   - apps/api         — webhook receiver route (PR-C3b)
 *
 * Both call `upsertOrderWithSnapshot(storeId, organizationId, mappedOrder)`
 * with the same MappedOrder DTO produced by `@pazarsync/marketplace`'s
 * `mapTrendyolShipmentPackage`. Cross-app duplication is unacceptable here
 * because the write semantics (idempotency keys, write-once snapshot, estimate
 * plug-in) must stay in lockstep — a webhook handler and a sync handler that
 * diverge could leave the DB in an inconsistent state.
 *
 * Idempotent:
 *   - Order UPSERT on (storeId, platformOrderId)
 *   - OrderItem INSERT skip-if-exists, platformLineId-first (legacy fallback:
 *     (orderId, productVariantId) for lines/rows without a platform line id)
 *   - captureCostSnapshot inner guard ile write-once
 *   - applyEstimateOnOrderCreate inner guard ile write-once
 *     (estimatedNetProfit non-null ise no-op)
 *
 * PR-6 continuation (2026-05-21): captureCostSnapshot now writes the
 * three NET split columns (`unitCostSnapshotNet`, `unitCostSnapshotVatAmount`,
 * `unitCostSnapshotVatRate`). The estimated_net_profit gap that prevented
 * applyEstimateOnOrderCreate from completing the write is now closed.
 * Legacy `unitCostSnapshot` stays NULL; column drop scheduled for PR-8+.
 */

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { CostProfileType, Currency, FxRateMode, Prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { applyEstimateOnOrderCreate } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

interface SnapshotComponentData {
  orderItemId: string;
  organizationId: string;
  profileId: string;
  profileName: string;
  profileType: CostProfileType;
  amount: Decimal;
  currency: Currency;
  vatRate: number;
  amountInTry: Decimal;
  // PR-6 continuation: KDV snapshot in native currency + TRY (mirror of
  // apps/api/src/services/cost-snapshot.service.ts SnapshotComponentData).
  vatAmount: Decimal;
  vatAmountInTry: Decimal;
  fxRateMode: FxRateMode;
  fxRateUsed: Decimal;
  fxRateSource: string;
}

interface FxResolution {
  rate: Decimal;
  source: string;
}

/**
 * FX rate resolve helper. Mirrors `apps/api/src/services/fx-rates.service.ts`
 * — same logic, runs inside the upsert transaction so a rate change between
 * the read and the order item write cannot race.
 *
 * Returns null when an AUTO rate is unavailable (no fx_rates row for the
 * currency). Caller (captureCostSnapshot) treats that as best-effort abort
 * and leaves the snapshot null.
 */
async function resolveFx(
  profile: { currency: Currency; fxRateMode: FxRateMode; manualFxRate: Decimal | null },
  tx: Prisma.TransactionClient,
): Promise<FxResolution | null> {
  if (profile.currency === 'TRY') {
    return { rate: new Decimal(1), source: 'TRY-NATIVE' };
  }
  if (profile.fxRateMode === 'MANUAL') {
    if (profile.manualFxRate === null) {
      throw new Error('Profile has fxRateMode=MANUAL but manualFxRate is null');
    }
    return { rate: new Decimal(profile.manualFxRate), source: 'MANUAL' };
  }
  const row = await tx.fxRate.findFirst({
    where: { currency: profile.currency },
    orderBy: { rateDate: 'desc' },
  });
  if (!row) return null;
  const dateStr = row.rateDate.toISOString().slice(0, 10);
  return { rate: new Decimal(row.rateToTry), source: `TCMB-${dateStr}` };
}

/**
 * Capture unit_cost_snapshot for a newly-inserted OrderItem.
 * Best-effort: if FX rate is unavailable or no profiles are attached,
 * exits silently leaving the snapshot null.
 *
 * Mirrors apps/api/src/services/cost-snapshot.service.ts#captureCostSnapshot.
 * The two implementations must stay in sync if the spec changes.
 */
async function captureCostSnapshot(
  orderItemId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const item = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    include: { productVariant: true },
  });

  if (!item || item.unitCostSnapshotNet !== null || !item.productVariantId) {
    return;
  }

  const links = await tx.productVariantCostProfile.findMany({
    where: { productVariantId: item.productVariantId },
    include: { profile: true },
  });

  const activeProfiles = links.map((l) => l.profile).filter((p) => p.archivedAt === null);

  if (activeProfiles.length === 0) return;

  const components: SnapshotComponentData[] = [];

  for (const profile of activeProfiles) {
    const fx = await resolveFx(profile, tx);
    if (fx === null) {
      syncLog.warn('snapshot.fx-unavailable', {
        orderItemId,
        profileId: profile.id,
        currency: profile.currency,
      });
      return; // best-effort: abort, leave null
    }
    // KDV split — mirror of apps/api/src/services/cost-snapshot.service.ts.
    // `profile.amount = NET` (schema convention); canonical
    // `vatAmount = amount × vatRate / 100`. Defensive compute when nullable
    // backfill column is null.
    const amountNet = new Decimal(profile.amount);
    const vatAmountNative =
      profile.vatAmount !== null
        ? new Decimal(profile.vatAmount)
        : amountNet.mul(profile.vatRate).div(100);

    components.push({
      orderItemId,
      organizationId: item.organizationId ?? '',
      profileId: profile.id,
      profileName: profile.name,
      profileType: profile.type,
      amount: amountNet,
      currency: profile.currency,
      vatRate: profile.vatRate,
      amountInTry: amountNet.mul(fx.rate),
      vatAmount: vatAmountNative,
      vatAmountInTry: vatAmountNative.mul(fx.rate),
      fxRateMode: profile.fxRateMode,
      fxRateUsed: fx.rate,
      fxRateSource: fx.source,
    });
  }

  // Aggregate NET + VAT (TRY) across profiles. Effective vatRate denormalized
  // for downstream consumers — multi-profile case yields a blended rate.
  const unitCostSnapshotNet = components
    .reduce((acc, c) => acc.add(c.amountInTry), new Decimal(0))
    .toDecimalPlaces(2);
  const unitCostSnapshotVatAmount = components
    .reduce((acc, c) => acc.add(c.vatAmountInTry), new Decimal(0))
    .toDecimalPlaces(2);
  // NET=0 → rate is undefined (0% is a valid export rate, would alias the
  // states). Leave denormalized rate NULL. Mirror of cost-snapshot.service.
  const unitCostSnapshotVatRate = unitCostSnapshotNet.isZero()
    ? null
    : unitCostSnapshotVatAmount.div(unitCostSnapshotNet).mul(100).toDecimalPlaces(2);

  await tx.orderItem.update({
    where: { id: orderItemId },
    data: {
      unitCostSnapshotNet,
      unitCostSnapshotVatAmount,
      unitCostSnapshotVatRate,
      snapshotCapturedAt: new Date(),
    },
  });

  await tx.orderItemCostSnapshotComponent.createMany({ data: components });
}

/**
 * Persist a single mapped order + its items in one transaction.
 *
 * NEW convention native (design §5.2 + Order Sync design §5.2):
 *   - Order: saleSubtotalNet + saleVatTotal aggregate'ı MappedOrder'dan.
 *     agreedDeliveryDate, actualDeliveryDate, fastDelivery, micro direct API.
 *   - OrderItem: unitPriceNet/VatRate/VatAmount + grossCommissionAmountNet/Vat
 *     + sellerDiscountNet/VatAmount. Variant lookup by barcode (storeId scoped).
 *   - Cost snapshot capture: write-once per item (existing service mirror).
 *   - applyEstimateOnOrderCreate (`@pazarsync/profit`): aynı tx içinde son adım
 *     olarak çağrılır — PSF + Stopaj ESTIMATE OrderFee rows + Order.estimatedNetProfit
 *     write-once. Cost snapshot eksikse profit null kalır.
 */
export async function upsertOrderWithSnapshot(
  storeId: string,
  organizationId: string,
  order: MappedOrder,
  existingTx?: Prisma.TransactionClient,
): Promise<void> {
  // The transactional body. The default path (webhook / polling sync handlers)
  // opens its own transaction; the buffer-promote worker (PR-C) passes its own
  // `tx` so the order write and the buffer-row delete commit atomically — a
  // promoted order is never left half-written with its buffer placeholder still
  // present (which would double-count it on the Live Performance page).
  const run = async (tx: Prisma.TransactionClient): Promise<void> => {
    // 1. UPSERT Order — NEW convention native.
    //    Sale/discount agregat'ı + flagler MappedOrder'dan direkt.
    //    Mutable update: status + actualDeliveryDate + lastModifiedDate-driven values.
    const upserted = await tx.order.upsert({
      where: {
        storeId_platformOrderId: { storeId, platformOrderId: order.platformOrderId },
      },
      create: {
        organizationId,
        storeId,
        platformOrderId: order.platformOrderId,
        platformOrderNumber: order.platformOrderNumber,
        orderDate: order.orderDate,
        status: order.status,
        saleSubtotalNet: order.saleSubtotalNet,
        saleVatTotal: order.saleVatTotal,
        agreedDeliveryDate: order.agreedDeliveryDate,
        actualDeliveryDate: order.actualDeliveryDate,
        fastDelivery: order.fastDelivery,
        micro: order.micro,
        // PR-8 kargo alanları (research 2026-06-09). DİKKAT: `mappedOrder`
        // buffer'dan JSONB olarak da gelir — yeni alanlar eski kayıtlarda
        // UNDEFINED'dır (null değil). Bu yüzden tüm korumalar gevşek `!= null`
        // (null + undefined) kullanır; BigInt(undefined) fırlatır.
        cargoProviderName: order.cargoProviderName ?? null,
        cargoTrackingNumber:
          order.cargoTrackingNumber != null ? BigInt(order.cargoTrackingNumber) : null,
        cargoDeci: order.cargoDeci ?? null,
        usesSellerCargoAgreement: order.usesSellerCargoAgreement ?? false,
        platformCreatedBy: order.platformCreatedBy ?? null,
        originShipmentDate:
          order.originShipmentDate != null ? new Date(order.originShipmentDate) : null,
      },
      update: {
        status: order.status,
        // actualDeliveryDate sadece null → non-null geçişi için (delivered event'i)
        ...(order.actualDeliveryDate !== null && { actualDeliveryDate: order.actualDeliveryDate }),
        // Kargo alanları null-koruma ile tazelenir: cargoDeci kargo ölçümünden
        // SONRA dolar, tracking no nadiren rotasyonla değişir — dolu gelen değer
        // yazılır, null/undefined gelen mevcut dolu değeri EZMEZ (eski/webhook
        // feed'leri ve buffer JSONB'si alanları taşımayabilir).
        // usesSellerCargoAgreement dolu geldiğinde yazılır (mapper her zaman
        // boolean üretir; yalnız eski buffer JSONB'sinde undefined olabilir).
        ...(order.cargoProviderName != null && { cargoProviderName: order.cargoProviderName }),
        ...(order.cargoTrackingNumber != null && {
          cargoTrackingNumber: BigInt(order.cargoTrackingNumber),
        }),
        ...(order.cargoDeci != null && { cargoDeci: order.cargoDeci }),
        ...(order.usesSellerCargoAgreement != null && {
          usesSellerCargoAgreement: order.usesSellerCargoAgreement,
        }),
        ...(order.platformCreatedBy != null && { platformCreatedBy: order.platformCreatedBy }),
        ...(order.originShipmentDate != null && {
          originShipmentDate: new Date(order.originShipmentDate),
        }),
      },
    });

    // 2. OrderItem'lar: variant lookup (barcode) + INSERT-if-new + snapshot.
    for (const line of order.lines) {
      const variant = await tx.productVariant.findFirst({
        where: { storeId, barcode: line.barcode },
        select: { id: true },
      });

      // Dedupe (write-once item): platformLineId platform-taraflı satır
      // kimliği — varsa birincil anahtar odur (variant'sız satırlar NULL-FK
      // üzerinden çakışamaz; resolution-öncesi re-scan duplike üretemez).
      // platformLineId'siz satır (eski buffer JSONB replay'i, sparse payload)
      // legacy variant anahtarına düşer. DB tarafı da NULL taşıyabilir
      // (pre-PR-8 satırlar + legacy replay ürünleri) → gelen satır
      // platformLineId'li olsa bile NULL'da kalmış mevcut satırı legacy
      // anahtarla da ara; yoksa aynı fiziksel satır re-delivery'de İKİNCİ kez
      // yazılır (çift sayım — eski anahtar bunu yakalıyordu).
      const existing = await tx.orderItem.findFirst({
        where:
          line.platformLineId != null
            ? {
                orderId: upserted.id,
                OR: [
                  { platformLineId: BigInt(line.platformLineId) },
                  { platformLineId: null, productVariantId: variant?.id ?? null },
                ],
              }
            : { orderId: upserted.id, productVariantId: variant?.id ?? null },
        select: { id: true, platformLineId: true },
      });
      if (existing !== null) {
        // Self-heal: legacy anahtarla yakalanan satıra platform kimliğini
        // damgala — sonraki re-scan'ler birincil anahtardan eşleşir, claims
        // eşleştirmesi (platformLineId) doğru satırı görür.
        if (line.platformLineId != null && existing.platformLineId === null) {
          await tx.orderItem.update({
            where: { id: existing.id },
            data: { platformLineId: BigInt(line.platformLineId) },
          });
        }
        continue;
      }

      if (variant === null) {
        // Variant resolution gap (edge case): productVariantId null bırakılır.
        // UI "variant bulunamadı" badge gösterir (design §6 Edge Cases).
        syncLog.warn('orders.variant-not-found', {
          storeId,
          orderId: upserted.id,
          barcode: line.barcode,
        });
      }

      const item = await tx.orderItem.create({
        data: {
          orderId: upserted.id,
          organizationId,
          productVariantId: variant?.id ?? null,
          quantity: line.quantity,
          // PR-8: platform satır izi + ham barkod (variant-eşleşmezse tek ürün izi).
          // Gevşek `!= null`: buffer JSONB'sinden gelen eski satırlarda alan
          // undefined'dır — BigInt(undefined) fırlatır.
          platformLineId: line.platformLineId != null ? BigInt(line.platformLineId) : null,
          barcode: line.barcode,
          // ESKI KDV-dahil kolonları (PR-5c'de silinmediler — backwards compat).
          // unitPrice = unitPriceNet + unitVatAmount; commissionAmount = gross.
          unitPrice: new Decimal(line.unitPriceNet).add(new Decimal(line.unitVatAmount)),
          commissionRate: new Decimal(line.commissionRate),
          commissionAmount: new Decimal(line.grossCommissionAmountNet).add(
            new Decimal(line.grossCommissionVatAmount),
          ),
          // NEW convention (KDV-split native — design §3.2):
          unitPriceNet: new Decimal(line.unitPriceNet),
          unitVatRate: new Decimal(line.unitVatRate),
          unitVatAmount: new Decimal(line.unitVatAmount),
          grossCommissionAmountNet: new Decimal(line.grossCommissionAmountNet),
          grossCommissionVatAmount: new Decimal(line.grossCommissionVatAmount),
          // refundedCommission* PR-5c default 0 — Settlement worker Discount
          // transaction'larından doldurur (PR-7 V1 resume).
          sellerDiscountNet: new Decimal(line.sellerDiscountNet),
          sellerDiscountVatAmount: new Decimal(line.sellerDiscountVatAmount),
        },
      });

      // Cost snapshot capture (write-once iç guard).
      await captureCostSnapshot(item.id, tx);
    }

    // 3. applyEstimateOnOrderCreate — T+0 write-once tahmini kar.
    //    Aynı tx içinde PSF + Stopaj ESTIMATE OrderFee yazar +
    //    Order.estimatedNetProfit set'ler. Cost snapshot eksikse profit null
    //    kalır (re-entry idempotent — cost profile sonradan eklenirse caller
    //    yeniden çağırır).
    await applyEstimateOnOrderCreate(upserted.id, tx);
  };

  if (existingTx !== undefined) {
    await run(existingTx);
    return;
  }
  await prisma.$transaction(run);
}
