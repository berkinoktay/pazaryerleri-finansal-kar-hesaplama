/**
 * Order/OrderItem write-once upsert + profit recompute enqueue — single
 * transaction, GROSS convention (KDV-dahil native, 2026-06-16).
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
 *   - enqueueProfitRecompute on every write (create + update): one mark per order.
 *     The sync-worker tick drains it and computes the statement in its own short
 *     transaction; a compute failure there never rolls back this order write.
 */

import { Decimal } from 'decimal.js';

import { refreshProductAggregates } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import type { Platform, Prisma, ProfitExclusionReason } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import type { MappedOrder } from '@pazarsync/marketplace';
import { enqueueProfitRecompute, resolveCommissionRate } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';
import { resolveProfitSettings } from '@pazarsync/utils';

import { decrementVariantStock, isOrderOnBusinessToday } from './stock';

/**
 * Resolve the effective commission for a mapped line, applying the DB category
 * base_rate fallback when the webhook carried no commission of its own.
 *
 * Precedence:
 *   1. commissionKnown !== false (true OR legacy-undefined) → trust the mapped
 *      commission values as-is (existing behavior; no DB read).
 *   2. commissionKnown === false with a categoryId and a known platform → look
 *      up the category base_rate (sellerSegment=null) and recompute
 *      commissionGross/refundedCommissionGross with mapLine's exact formula.
 *   3. Category has no rule in the DB (resolver returns null) → keep the mapped
 *      0 fallback (unchanged legacy behavior) and warn.
 */
async function resolveEffectiveCommission(
  line: MappedOrder['lines'][number],
  platform: Platform | null,
  tx: Prisma.TransactionClient,
): Promise<{
  commissionRate: Decimal;
  commissionGross: Decimal;
  refundedCommissionGross: Decimal;
}> {
  // commissionKnown !== false (true veya legacy undefined) -> mapped degerleri KULLAN (mevcut davranis).
  if (line.commissionKnown !== false || line.categoryId === null || platform === null) {
    return {
      commissionRate: new Decimal(line.commissionRate),
      commissionGross: new Decimal(line.commissionGross),
      refundedCommissionGross: new Decimal(line.refundedCommissionGross),
    };
  }
  // Webhook komisyon tasimadi -> DB kategori base_rate fallback (sellerSegment=null).
  const resolved = await resolveCommissionRate(
    { platform, categoryId: BigInt(line.categoryId), brandId: null, sellerSegment: null },
    tx,
  );
  if (resolved === null) {
    syncLog.warn('orders.commission-fallback-miss', {
      barcode: line.barcode,
      categoryId: line.categoryId,
    });
    return {
      commissionRate: new Decimal(line.commissionRate),
      commissionGross: new Decimal(line.commissionGross),
      refundedCommissionGross: new Decimal(line.refundedCommissionGross),
    };
  }
  const rate = resolved.rate;
  // mapLine ile AYNI formul: commissionGross = rate x lineListGross / 100; refunded = rate x lineSellerDiscountGross / 100.
  return {
    commissionRate: rate,
    commissionGross: new Decimal(line.lineListGross).mul(rate).div(100).toDecimalPlaces(2),
    refundedCommissionGross: new Decimal(line.lineSellerDiscountGross)
      .mul(rate)
      .div(100)
      .toDecimalPlaces(2),
  };
}

/**
 * Persist a single mapped order + its items in one transaction.
 *
 * GROSS convention native (2026-06-16):
 *   - Order: saleGross/saleVat/listGross/sellerDiscountGross (+ sellerDiscountVat)
 *     aggregate'ı MappedOrder paket toplamlarından. promotionDisplays UI gösterimi.
 *     agreedDeliveryDate, actualDeliveryDate, fastDelivery, micro direct API.
 *   - OrderItem: lineListGross/lineSaleGross/lineSellerDiscountGross/saleVatRate +
 *     commissionGross/refundedCommissionGross/commissionVatRate +
 *     estimatedCommissionGross (write-once #340) + orderCommissionRatePct (the line's
 *     own raw rate). Variant lookup by barcode (storeId scoped).
 *   - Snapshot-at-create: the store's resolved profit settings are copied onto the
 *     order on CREATE only (forward-only; an UPDATE never rewrites them).
 *   - enqueueProfitRecompute (`@pazarsync/profit`): the last step of the tx on
 *     create and update alike — one mark per order for the sync-worker tick to drain.
 */
export interface UpsertOrderOpts {
  /**
   * Cost-window exclusion (Berkin 2026-11-03): when set, the order is stamped
   * profit-excluded. Written ONLY on a genuine create -- the UPDATE branch omits
   * both columns, so a later re-delivery of an already-excluded order can never
   * clear the stamp, and the stale-event case never overwrites it. Only two
   * callers set it: intake-order's past-day route (LATE_UNCOSTED_ARRIVAL) and the
   * buffer day-end graduation (COST_DEADLINE_MISSED). The permanence trigger
   * (Faz 3E, Gorev 3) additionally rejects any attempt to clear or change an
   * automatic exclusion at the database layer.
   */
  profitExclusion?: { readonly reason: ProfitExclusionReason };
  /**
   * Set true by the buffer-promote worker when this order graduates from the
   * live-performance buffer (the seller already saw it as a cost-missing entry).
   * Stamps `promotedFromBufferAt` so the realtime new-order toast can suppress a
   * duplicate "new order" ding for an order the seller has already been shown.
   * CREATE-only by design: an UPDATE never emits a Realtime INSERT event, so the
   * toast pipeline never reads it — stamping it on update would be meaningless.
   */
  promotedFromBuffer?: boolean;
}

export async function upsertOrderWithSnapshot(
  storeId: string,
  organizationId: string,
  order: MappedOrder,
  existingTx?: Prisma.TransactionClient,
  opts?: UpsertOrderOpts,
): Promise<void> {
  // The transactional body. The default path (webhook / polling sync handlers)
  // opens its own transaction; the buffer-promote worker (PR-C) passes its own
  // `tx` so the order write and the buffer-row delete commit atomically — a
  // promoted order is never left half-written with its buffer placeholder still
  // present (which would double-count it on the Live Performance page).
  const run = async (tx: Prisma.TransactionClient): Promise<void> => {
    // Out-of-order guard (freshness): a stale webhook re-delivery or a racing
    // hourly-sync page can arrive AFTER a newer event already wrote this row.
    // `platformLastModifiedAt` records the marketplace lastModifiedDate of the
    // freshest event applied so far. If the incoming event is strictly OLDER,
    // skip the ENTIRE write and return early: the item insert, cost snapshot,
    // and estimate are all write-once, and a stale event carries no fresher
    // information — applying it would only regress status/fields. Equality
    // passes (falls through to the idempotent upsert) so a same-lastModifiedDate
    // re-delivery keeps the existing behavior. `incomingLmd` is derived with the
    // loose `!= null` guard because `mappedOrder` also arrives as buffer JSONB on
    // the promote path, where `lastModifiedDate` may be an ISO string or (on
    // legacy rows) undefined; a null incoming value skips the guard by design.
    //
    // Scope: this closes the SEQUENTIAL out-of-order case. Two CONCURRENT
    // in-flight transactions can still last-write-win under Read Committed (both
    // read the same watermark before either commits), which self-heals on the
    // next delivery and is never worse than the pre-guard behavior; taking a row
    // lock here was deliberately avoided to keep the hot intake path lock-free.
    const existingOrder = await tx.order.findUnique({
      where: {
        storeId_platformOrderId: { storeId, platformOrderId: order.platformOrderId },
      },
      select: { platformLastModifiedAt: true },
    });
    // Normalize a corrupt lastModifiedDate (e.g. a malformed string from a
    // replayed JSONB snapshot) to null: an Invalid Date must neither drive the
    // guard nor be stamped, or it would flow into the CREATE/UPDATE below and
    // abort the whole order persist at the Prisma layer.
    const parsedLmd = order.lastModifiedDate != null ? new Date(order.lastModifiedDate) : null;
    const incomingLmd = parsedLmd !== null && Number.isNaN(parsedLmd.getTime()) ? null : parsedLmd;
    if (
      existingOrder !== null &&
      existingOrder.platformLastModifiedAt !== null &&
      incomingLmd !== null &&
      incomingLmd.getTime() < existingOrder.platformLastModifiedAt.getTime()
    ) {
      return;
    }

    // Store read (Gorev 4 review): one read serves both the create-only profit-settings
    // snapshot and the commission fallback's platform lookup below. It stays lazy -- the
    // read happens only on a genuine create (existingOrder === null) or when at least one
    // line arrived without a commission (commissionKnown === false) and needs the DB
    // category base_rate fallback -- so the hot update path with full commissions takes no
    // extra query.
    const needsCommissionFallback = order.lines.some((l) => l.commissionKnown === false);
    const storeRow =
      existingOrder === null || needsCommissionFallback
        ? await tx.store.findUnique({
            where: { id: storeId },
            select: { profitSettings: true, platform: true },
          })
        : null;

    // Snapshot-at-create (decision 3): copy the store's resolved profit settings onto
    // the order on CREATE only. An UPDATE never touches the snapshot — a later settings
    // change is forward-only by design. resolveProfitSettings fills defaults for a
    // missing/empty JSON, so the snapshot booleans are always set. On an UPDATE the
    // stored snapshot is passed `undefined` and the resolved defaults are never read.
    const createProfitSettings = resolveProfitSettings(
      existingOrder === null ? storeRow?.profitSettings : undefined,
    );

    // Mikro ihracat (Trendyol marketplace `micro=true`): satış KDV'den müstesnadır
    // (ihracat istisnası, 3065 sayılı KDV Kanunu 11/1-a — e-arşiv fatura tipi "İstisna").
    // KDV'yi KAYNAKTA sıfırlarız (Order.saleVat + OrderItem.saleVatRate + sellerDiscountVat):
    // depolanan değer GERÇEKTİR (distorsiyon değil), tüm kâr yolları (estimate/settled/
    // breakdown) + liste/özet otomatik doğru olur. Komisyon/kargo TR içiyle aynı kalır.
    const microExport = order.micro === true;

    // sellerDiscountVat: satıcı indirimi KDV'si — per-line GERÇEK satış KDV oranından
    // türetilir (hardcoded %20 DEĞİL). %10 satışlarda (Türk bayrağı, kitap) %20
    // varsayımı yanlış değer saklardı. Her satırın lineSellerDiscountGross'u kendi
    // saleVatRate'i ile KDV'ye çevrilir; TAM PRECISION'da biriktirilir, persist'te
    // BİR kez yuvarlanır (Bug 1 ile aynı precision disiplini). Türev gösterim kolonu
    // (kâr formülünde değil) ama doğru değer olmalı. Mikro ihracatta satış KDV %0 → 0.
    const sellerDiscountVat = microExport
      ? new Decimal(0)
      : order.lines
          .reduce((acc, line) => {
            const discountGross = new Decimal(line.lineSellerDiscountGross);
            const rate = new Decimal(line.saleVatRate);
            if (rate.isZero()) return acc;
            return acc.add(discountGross.mul(rate).div(new Decimal(100).add(rate)));
          }, new Decimal(0))
          .toDecimalPlaces(2);

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
        // GROSS konvansiyon (2026-06-16): sipariş başlığı paket toplamlarından
        // DOĞRUDAN (KDV-dahil) — net/KDV downstream kâr motorunda türetilir.
        // sellerDiscountVat per-line gerçek saleVatRate'ten türetilir (yukarıda),
        // hardcoded %20 DEĞİL — karışık/standart-dışı KDV oranlı satışlarda doğru.
        // listGross/saleVat mapper'dan gelir; promotionDisplays UI gösterimi (ekleme #3).
        saleGross: new Decimal(order.saleGross),
        // Mikro ihracat → satış KDV %0 (ihracat istisnası). saleGross (KDV-dahil tutar)
        // değişmez; yalnız KDV bileşeni 0 olur (saleNet = saleGross).
        saleVat: microExport ? new Decimal(0) : new Decimal(order.saleVat),
        listGross: new Decimal(order.listGross),
        sellerDiscountGross: new Decimal(order.sellerDiscountGross),
        sellerDiscountVat,
        promotionDisplays:
          order.promotionDisplays !== null
            ? order.promotionDisplays.map((p) => ({
                displayName: p.displayName,
                amountGross: p.amountGross,
              }))
            : undefined,
        agreedDeliveryDate: order.agreedDeliveryDate,
        actualDeliveryDate: order.actualDeliveryDate,
        // Türetilmiş zamanında-teslim. Buffer JSONB'sinden gelen eski kayıtlarda
        // UNDEFINED olabilir → ?? null (diğer yeni alanlarla aynı koruma).
        deliveredOnTime: order.deliveredOnTime ?? null,
        // actualShipDate: Shipped event'i (taşıma durumuna geçiş). Buffer JSONB'sinden
        // string/undefined gelebilir → != null + new Date() ile sarılır.
        actualShipDate: order.actualShipDate != null ? new Date(order.actualShipDate) : null,
        // Tahmini teslim penceresi (PROD'da dolu). Buffer JSONB'sinden string
        // gelebilir → new Date() ile sarılır (originShipmentDate ile aynı koruma).
        estimatedDeliveryStartDate:
          order.estimatedDeliveryStartDate != null
            ? new Date(order.estimatedDeliveryStartDate)
            : null,
        estimatedDeliveryEndDate:
          order.estimatedDeliveryEndDate != null ? new Date(order.estimatedDeliveryEndDate) : null,
        fastDelivery: order.fastDelivery,
        // fastDeliveryType: sipariş-seviyesi tip (PROD'da dolu). Eski buffer
        // JSONB'sinde UNDEFINED olabilir → ?? null.
        fastDeliveryType: order.fastDeliveryType ?? null,
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
        // Out-of-order guard baseline: stamp the freshest lastModifiedDate seen so
        // subsequent stale events are rejected. Null when the buffer JSONB replay
        // carries no lastModifiedDate (legacy rows).
        platformLastModifiedAt: incomingLmd,
        // Snapshot-at-create (decision 3): the store's resolved profit settings are
        // copied onto the order here and never rewritten on the UPDATE branch below.
        snapshotIncludeStopaj: createProfitSettings.includeStopaj,
        snapshotIncludeNegativeNetVat: createProfitSettings.includeNegativeNetVat,
        // Cost-window exclusion (Berkin 2026-11-03): an order whose cost missed its
        // business day is stamped profit-excluded ON CREATE ONLY -- the update branch
        // below never touches these two columns, so a later re-delivery cannot clear
        // the stamp. Stamp and reason are set together to satisfy the pair check.
        ...(opts?.profitExclusion !== undefined && {
          profitExcludedAt: new Date(),
          profitExclusionReason: opts.profitExclusion.reason,
        }),
        // Buffer-graduation marker (CREATE-only): the realtime toast reads this to
        // drop a duplicate "new order" for an order the seller already saw in the
        // buffer. Deliberately NOT in the update branch — an UPDATE emits no
        // Realtime INSERT event, so the toast pipeline would never consult it.
        ...(opts?.promotedFromBuffer === true && { promotedFromBufferAt: new Date() }),
      },
      update: {
        status: order.status,
        // actualDeliveryDate sadece null → non-null geçişi için (delivered event'i)
        ...(order.actualDeliveryDate !== null && { actualDeliveryDate: order.actualDeliveryDate }),
        // deliveredOnTime: delivered event'iyle birlikte tazele (actualDeliveryDate ile aynı kapı).
        ...(order.actualDeliveryDate !== null && {
          deliveredOnTime: order.deliveredOnTime ?? null,
        }),
        // actualShipDate: Shipped event'i sonraki sync'te gelir → null→non-null tazele.
        ...(order.actualShipDate != null && { actualShipDate: new Date(order.actualShipDate) }),
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
        // Advance the freshness watermark only when the incoming event carries a
        // lastModifiedDate. A null (legacy buffer JSONB) must not overwrite an
        // existing watermark, or a later stale event could slip past the guard.
        ...(incomingLmd !== null && { platformLastModifiedAt: incomingLmd }),
      },
    });

    // Commission fallback needs the store platform only when at least one line arrived
    // without a commission (commissionKnown === false). It was already resolved by the
    // single store read above (storeRow), so the hot intake path takes no extra query.
    const storePlatform: Platform | null = needsCommissionFallback
      ? (storeRow?.platform ?? null)
      : null;

    // Optimistic between-scans stock: the distinct products whose variant stock
    // we decrement below (one first-insert per line). Recomputed once after the
    // loop so Product.totalStock stays consistent with the touched variants.
    const affectedProductIds = new Set<string>();

    // Optimistic decrement mirrors LIVE sales only, so it fires only for an order
    // whose business date is TODAY. Without this gate a freshly connected store's
    // bootstrap ORDERS sync (window [store.createdAt, now]) or a dev/stage backfill
    // would floor catalog stock toward 0 for every historical first-insert until
    // the next authoritative scan. Past-day first-inserts (bootstrap seam,
    // backfill, late arrivals) leave stock to the authoritative catalog scans.
    // Business date via the canonical @pazarsync/utils helper — APP_TIME_ZONE
    // single source, never a hand-rolled AT TIME ZONE. Loop-invariant (the whole
    // order shares one orderDate), so it is computed once here. The helper
    // normalizes a JSONB-revived string orderDate (buffer-promote path) and can
    // never throw — a bad date just skips the decrement.
    //
    // promotedFromBuffer skip (owner ruling 2026-07-11): a buffer graduation must
    // NOT decrement again. The sale is real the moment the order arrives, so the
    // buffered-intake path (intake-order.ts) already dropped this order's stock
    // when it first parked in the cost-missing buffer; decrementing again here
    // would subtract the same units twice. Only a DIRECT first insert (never
    // buffered) decrements at persist. Evaluated after isOrderOnBusinessToday so
    // the string-orderDate gate is still exercised on the promote path (it must
    // never throw), even though the graduation itself moves no stock.
    const orderIsBusinessToday = isOrderOnBusinessToday(order.orderDate);
    const shouldDecrement =
      orderIsBusinessToday && order.status !== 'CANCELLED' && opts?.promotedFromBuffer !== true;

    // 2. OrderItem'lar: variant lookup (barcode) + INSERT-if-new + snapshot.
    for (const line of order.lines) {
      const variant = await tx.productVariant.findFirst({
        where: { storeId, barcode: line.barcode },
        // productId is selected so the first-insert stock decrement below can
        // recompute the owning product's denormalized totalStock.
        select: { id: true, productId: true },
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
        select: {
          id: true,
          platformLineId: true,
          commissionGross: true,
          settledCommissionGross: true,
        },
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
        // Two-phase webhook (#426): a later event that finally carries the line's own
        // commission (commissionKnown === true) refreshes the raw order_commission_rate_pct
        // column the loader reads. While the parcel is not yet settled it ALSO refreshes the
        // legacy estimate-side commission columns, but only when the recomputed commission
        // differs from the stored value. Decision (Gorev 4 review): fold both into ONE
        // tx.orderItem.update so a refreshed line is a single write -- the raw rate always
        // moves, the legacy columns only when they changed. Once the parcel is settled
        // (settledCommissionGross set) the legacy columns are frozen, so only the raw rate is
        // written in its own update. The freshness guard above already dropped any strictly-
        // older event, so only a newer-or-equal event reaches here; the profit recompute is
        // enqueued once at the end of this function.
        if (line.commissionKnown === true) {
          if (existing.settledCommissionGross === null) {
            const eff = await resolveEffectiveCommission(line, storePlatform, tx);
            const legacyChanged = !eff.commissionGross.equals(
              new Decimal(existing.commissionGross),
            );
            await tx.orderItem.update({
              where: { id: existing.id },
              data: {
                orderCommissionRatePct: new Decimal(line.commissionRate),
                ...(legacyChanged && {
                  commissionRate: eff.commissionRate,
                  commissionGross: eff.commissionGross,
                  refundedCommissionGross: eff.refundedCommissionGross,
                  estimatedCommissionGross: eff.commissionGross,
                }),
              },
            });
          } else {
            await tx.orderItem.update({
              where: { id: existing.id },
              data: { orderCommissionRatePct: new Decimal(line.commissionRate) },
            });
          }
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

      // Commission with DB category base_rate fallback when the line carried no
      // real commission (commissionKnown === false). Otherwise the mapped values
      // pass through unchanged.
      const eff = await resolveEffectiveCommission(line, storePlatform, tx);

      await tx.orderItem.create({
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
          // GROSS konvansiyon (2026-06-16): satır para değerleri GROSS (KDV-dahil).
          // Satış: lineListGross (liste×adet) / lineSaleGross (effectiveSale) /
          // lineSellerDiscountGross (satıcı indirimi) + saleVatRate. Komisyon:
          // commissionRate × lineListGross = commissionGross (LİSTE brüt) + ayrı
          // refundedCommissionGross (satıcı-indirim payının komisyon iadesi); effective
          // = gross − refunded = effectiveSale × rate (net-satış tabanı #332, çift-düşme
          // YOK — taban liste, indirim yalnız refunded'da düşülür).
          lineListGross: new Decimal(line.lineListGross),
          lineSaleGross: new Decimal(line.lineSaleGross),
          lineSellerDiscountGross: new Decimal(line.lineSellerDiscountGross),
          // Mikro ihracat → satış KDV oranı %0 (ihracat istisnası). build-profit-breakdown
          // saleVat'i bu orandan türetir → micro siparişte 0 (Order.saleVat=0 ile tutarlı).
          saleVatRate: microExport ? new Decimal(0) : new Decimal(line.saleVatRate),
          commissionRate: eff.commissionRate,
          commissionGross: eff.commissionGross,
          refundedCommissionGross: eff.refundedCommissionGross,
          commissionVatRate: new Decimal(line.commissionVatRate),
          // Komisyon TAHMİNİ (#340): T+0'da mapper değeri — webhook komisyon taşımazsa
          // kategori base_rate fallback'i (resolveEffectiveCommission). Sonraki webhook
          // gerçek komisyonu getirince settlement'a kadar TAZELENİR (mevcut-satır dalı);
          // settledCommissionGross yazılınca donar. Hakediş Kontrolü tahmin-vs-gerçek tabanı
          // (recompute-settled önce settledCommissionGross'u, yoksa bunu okur).
          estimatedCommissionGross: eff.commissionGross,
          // Raw order commission rate (phase 3B): the line's OWN rate, null when the
          // line carried no commission of its own. Never the category fallback that
          // resolveEffectiveCommission may produce in eff.commissionRate — the loader
          // reads this column and treats null/zero as "unknown".
          orderCommissionRatePct:
            line.commissionKnown === false ? null : new Decimal(line.commissionRate),
          // The legacy cost snapshot columns stay null: the profit engine reads cost
          // profiles directly, never these columns. They are removed in phase 5.
          unitCostSnapshotGross: null,
          unitCostSnapshotVatRate: null,
        },
      });

      // Optimistic between-scans stock decrement. This is the TRUE first insert
      // of this line (the existing-line branch above returned via `continue`, so
      // re-syncs and re-deliveries never reach here), so subtract the sold
      // quantity from the local variant stock to reflect the sale on the
      // products surface within seconds. Only when the variant resolved — an
      // unmatched line carries no stock to move. Catalog scans overwrite with the
      // authoritative vendor value; cancellations/returns deliberately do not
      // re-add (one-way simplicity, the scan reconciles). Owner-approved
      // 2026-07-11. See ./stock for the full contract.
      //
      // `shouldDecrement` (computed once above) keeps the decrement to genuine
      // live, direct sales:
      //   - orderIsBusinessToday: skip past-day first-inserts (bootstrap seam,
      //     backfill, late arrivals).
      //   - status !== CANCELLED: a sale whose FIRST event is already cancelled
      //     never consumed stock, so it must not decrement. The decrement is
      //     one-way (never re-added on cancel — the scan reconciles), so
      //     decrementing a born-cancelled order would understate stock until the
      //     next authoritative scan.
      //   - !promotedFromBuffer: a buffer graduation already decremented at
      //     intake — see the note where shouldDecrement is computed.
      if (variant !== null && shouldDecrement) {
        await decrementVariantStock(tx, variant.id, line.quantity);
        affectedProductIds.add(variant.productId);
      }
    }

    // Refresh the Product aggregates for every product whose variant stock we
    // just decremented, from its in-scope variants (listed, not archived). No-op
    // when nothing was decremented (all lines re-syncs or unmatched variants).
    await refreshProductAggregates(tx, storeId, [...affectedProductIds]);

    // 3. Enqueue a profit recompute for this order. The sync-worker tick drains the queue
    //    and computes the statement in its own short transaction; a compute failure there
    //    never rolls back this write. Tenant-scoped: enqueueProfitRecompute re-filters by
    //    organization and store, so only this order (upserted.id) is marked.
    //
    //    Decision (Gorev 4 review): skip the enqueue when this is an UPDATE whose incoming
    //    lastModifiedDate equals the stored watermark. Nothing on the order changed -- the
    //    same event re-delivered, or the 6-hourly ORDERS job re-reading an unchanged order
    //    -- so the recompute would be wasted work. Still enqueue on a create, on a strictly-
    //    newer event, and whenever either side's lmd is null (a legacy row, or a buffer
    //    replay carrying no lmd), because equality cannot be proven there. The strictly-
    //    older case already returned at the freshness guard above.
    const sameLastModified =
      existingOrder !== null &&
      existingOrder.platformLastModifiedAt !== null &&
      incomingLmd !== null &&
      incomingLmd.getTime() === existingOrder.platformLastModifiedAt.getTime();
    if (!sameLastModified) {
      await enqueueProfitRecompute(tx, {
        organizationId,
        storeId,
        orderIds: [upserted.id],
        reason: ProfitRecomputeReason.ORDER_CHANGED,
      });
    }
  };

  if (existingTx !== undefined) {
    await run(existingTx);
    return;
  }
  await prisma.$transaction(run);
}
