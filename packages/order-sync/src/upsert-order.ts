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
 *   - captureOrderProfitSnapshot on create only: the order's product inputs are
 *     frozen at intake and its seller inputs are captured at its business-day end, in
 *     the same transaction. The seller-input marker (`sellerInputsFinalAt`) is written
 *     on create only, and only for a settled past day; otherwise the order is created
 *     non-final and its seller inputs follow its day until the day-close pass.
 *   - enqueueProfitRecompute on every write (create + update): one mark per order.
 *     The sync-worker tick drains it and computes the statement in its own short
 *     transaction; a compute failure there never rolls back this order write.
 */

import { Decimal } from 'decimal.js';

import { refreshProductAggregates } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import type { Prisma, ProfitExclusionReason } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import type { MappedOrder } from '@pazarsync/marketplace';
import {
  captureOrderProfitSnapshot,
  enqueueProfitRecompute,
  findFirstVariantByBarcode,
} from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';
import { resolveProfitSettings } from '@pazarsync/utils';

import { decrementVariantStock, isOrderOnBusinessToday } from './stock';

/**
 * Persist a single mapped order + its items in one transaction.
 *
 * GROSS convention native (2026-06-16):
 *   - Order: saleGross/saleVat/listGross/sellerDiscountGross (+ sellerDiscountVat)
 *     aggregate'ı MappedOrder paket toplamlarından. promotionDisplays UI gösterimi.
 *     agreedDeliveryDate, actualDeliveryDate, fastDelivery, isExportSale direct API.
 *   - OrderItem: lineListGross/lineSaleGross/lineSellerDiscountGross/saleVatRate +
 *     orderCommissionRatePct (the line's own raw commission rate, null when the line
 *     carried none). The profit engine derives every commission amount from that rate;
 *     no commission or cost amount is stored on the item. Variant lookup by barcode
 *     (organizationId + storeId scoped, `findFirstVariantByBarcode`).
 *   - Snapshot-at-create: the store's resolved profit settings are copied onto the
 *     order on CREATE only (forward-only; an UPDATE never rewrites them).
 *   - enqueueProfitRecompute (`@pazarsync/profit`): the last step of the tx on
 *     create and update alike — one mark per order for the sync-worker tick to drain.
 */
export interface UpsertOrderOpts {
  /**
   * Cost-window + desi exclusion (Berkin 2026-11-03, 2026-11-22): when set, the order
   * is stamped profit-excluded. Written ONLY on a genuine create -- the UPDATE branch
   * omits both columns, so a later re-delivery of an already-excluded order can never
   * clear the stamp, and the stale-event case never overwrites it. Only two callers
   * set it, with four automatic reasons: intake-order's past-day route
   * (LATE_UNCOSTED_ARRIVAL / LATE_DESILESS_ARRIVAL, or the two deadline reasons when it
   * graduates a coexisting buffer row) and the buffer day-end graduation
   * (COST_DEADLINE_MISSED / DESI_DEADLINE_MISSED). The cost reason wins when both the
   * cost and the desi are missing. The permanence trigger (Faz 3E, Gorev 3)
   * additionally rejects any attempt to clear or change an automatic exclusion at the
   * database layer.
   */
  profitExclusion?: { readonly reason: ProfitExclusionReason };
  /**
   * Same-day edit window (plan PR-1, D8): when set, the order is created with its seller
   * inputs already final (`orders.seller_inputs_final_at`). Passed only for an order
   * whose business day is settled by `resolveSettledCutoff` (buffer graduation of a
   * settled past day, intake of a settled past day), with that cutoff's database clock,
   * so its exclusion is decided at create and the day-close pass never selects it.
   * Written ONLY on a genuine create, like `profitExclusion`: the UPDATE branch never
   * touches the column. Omitted -> the order is created non-final.
   */
  sellerInputsFinalAt?: Date;
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

/**
 * A mapped date field as a Date, or null when it is absent or invalid. The buffer
 * JSONB replay can carry these fields as ISO strings or leave them undefined, and an
 * Invalid Date must neither be written nor count as a change.
 */
function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** True when a valid incoming instant differs from the stored one (a stored null counts). */
function isNewInstant(stored: Date | null, incoming: Date | null): boolean {
  return incoming !== null && (stored === null || stored.getTime() !== incoming.getTime());
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
      // actualShipDate / agreedDeliveryDate: read so a ship date or ship-by deadline
      // that arrives with an unchanged lastModifiedDate still enqueues a recompute
      // (see step 4 below).
      select: { platformLastModifiedAt: true, actualShipDate: true, agreedDeliveryDate: true },
    });
    // Normalize a corrupt lastModifiedDate (e.g. a malformed string from a
    // replayed JSONB snapshot) to null: an Invalid Date must neither drive the
    // guard nor be stamped, or it would flow into the CREATE/UPDATE below and
    // abort the whole order persist at the Prisma layer.
    const parsedLmd = order.lastModifiedDate != null ? new Date(order.lastModifiedDate) : null;
    const incomingLmd = parsedLmd !== null && Number.isNaN(parsedLmd.getTime()) ? null : parsedLmd;
    // The ship date (the first Shipped history entry) and the ship-by deadline decide the
    // Barem table, so both are normalized once (toValidDate) and compared below.
    const incomingShipDate = toValidDate(order.actualShipDate);
    const incomingDeadline = toValidDate(order.agreedDeliveryDate);
    if (
      existingOrder !== null &&
      existingOrder.platformLastModifiedAt !== null &&
      incomingLmd !== null &&
      incomingLmd.getTime() < existingOrder.platformLastModifiedAt.getTime()
    ) {
      return;
    }

    // Store read: serves only the create-only profit-settings snapshot below, so it
    // stays lazy -- the read happens only on a genuine create (existingOrder === null)
    // and the hot update path takes no extra query.
    const storeRow =
      existingOrder === null
        ? await tx.store.findUnique({
            where: { id: storeId },
            select: { profitSettings: true },
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

    // Export sale (isExportSale; Trendyol marketplace `micro=true`): the sale is exempt from
    // VAT (export exemption, Turkish VAT law 3065 article 11/1-a; e-invoice type "Istisna").
    // The VAT is zeroed AT THE SOURCE (Order.saleVat, OrderItem.saleVatRate, sellerDiscountVat)
    // so the stored value is the real one and every profit path, list and summary reads it as
    // is. Commission and shipping stay the same as a domestic sale.
    const microExport = order.isExportSale;

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
        agreedDeliveryDate: incomingDeadline,
        actualDeliveryDate: order.actualDeliveryDate,
        // Türetilmiş zamanında-teslim. Buffer JSONB'sinden gelen eski kayıtlarda
        // UNDEFINED olabilir → ?? null (diğer yeni alanlarla aynı koruma).
        deliveredOnTime: order.deliveredOnTime ?? null,
        // actualShipDate: Shipped event'i (taşıma durumuna geçiş). Buffer JSONB'sinden
        // string/undefined gelebilir; geçersiz tarih null sayılır (yukarıdaki incomingShipDate).
        actualShipDate: incomingShipDate,
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
        isExportSale: microExport,
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
        // Seller-input marker (same-day edit window), CREATE-only like the exclusion:
        // a settled past-day order is created final, so the snapshot capture below
        // pins its inputs at the day end once and the day-close pass never selects it.
        ...(opts?.sellerInputsFinalAt !== undefined && {
          sellerInputsFinalAt: opts.sellerInputsFinalAt,
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
        ...(incomingShipDate !== null && { actualShipDate: incomingShipDate }),
        // agreedDeliveryDate: Trendyol's ship-by deadline. Refreshed when present so a
        // moved deadline re-decides the Barem table; null never clears a stored one.
        ...(incomingDeadline !== null && { agreedDeliveryDate: incomingDeadline }),
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
      // Lowest variant id for a barcode shared by two variants, inside the
      // organization's store: the same choice as buildCalcCheckLines, so the gate and
      // the stored order item name one variant. productId drives the first-insert
      // stock decrement's totalStock recompute below.
      const variant = await findFirstVariantByBarcode(tx, {
        organizationId,
        storeId,
        barcode: line.barcode,
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
        select: { id: true, platformLineId: true, orderCommissionRatePct: true },
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
        // column the loader reads. The freshness guard above already dropped any strictly-
        // older event, so only a newer-or-equal event reaches here; the profit recompute is
        // enqueued once at the end of this function. A re-sync that carries the same rate
        // writes nothing (every status change re-syncs every line).
        if (line.commissionKnown === true) {
          const rate = new Decimal(line.commissionRate);
          const unchanged =
            existing.orderCommissionRatePct !== null &&
            existing.orderCommissionRatePct.equals(rate);
          if (!unchanged) {
            await tx.orderItem.update({
              where: { id: existing.id },
              data: { orderCommissionRatePct: rate },
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
          // GROSS convention (2026-06-16): line money values are GROSS (VAT included).
          // Sale: lineListGross (list x quantity) / lineSaleGross (effective sale) /
          // lineSellerDiscountGross (seller discount) + saleVatRate.
          lineListGross: new Decimal(line.lineListGross),
          lineSaleGross: new Decimal(line.lineSaleGross),
          lineSellerDiscountGross: new Decimal(line.lineSellerDiscountGross),
          // Micro export -> sale VAT rate 0% (export exemption), consistent with
          // Order.saleVat = 0 on a micro order.
          saleVatRate: microExport ? new Decimal(0) : new Decimal(line.saleVatRate),
          // Raw order commission rate (phase 3B): the line's OWN rate, null when the
          // line carried no commission of its own. The loader reads this column and
          // treats null/zero as "unknown", falling back to the category rule.
          orderCommissionRatePct:
            line.commissionKnown === false ? null : new Decimal(line.commissionRate),
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

    // 3. Order profit snapshot (plan PR-2, decision 4): on a genuine create only, after
    //    the items are written and in this same transaction, capture the order's product
    //    and seller inputs, so the order is priced with the values of its intake moment.
    //    An update never captures here: the recompute it enqueues below fills whatever
    //    is still missing (an uncaptured order, a later-matched item, an empty cost list).
    if (existingOrder === null) {
      await captureOrderProfitSnapshot(tx, { organizationId, orderId: upserted.id });
    }

    // 4. Enqueue a profit recompute for this order. The sync-worker tick drains the queue
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
    //
    //    Load-bearing for the finance-record outbox: a settlement stored before this order
    //    existed had its bind_pending cleared by a bind pass that found no order, so it is
    //    never re-enqueued from that side (see bindPendingFinanceRecords in
    //    @pazarsync/profit). This create-time enqueue is the ONLY path that reaches such a
    //    record -- the recompute it triggers reads the already-stored record. Do NOT remove
    //    it or gate the create path on the order's content changing; the create always
    //    enqueues (sameLastModified is false when existingOrder is null).
    //
    //    Exception to the skip (plan PR-2b, decision 9): an UPDATE whose ship date is new
    //    (stored null) or a different instant still enqueues, even with an equal
    //    lastModifiedDate. The Barem table depends on the moment the parcel was handed to
    //    the carrier, and Trendyol can add that first Shipped entry without moving
    //    lastModifiedDate -- without this, a promised order shipped late would keep its
    //    optimistic table 1 figure. The same holds for a moved ship-by deadline
    //    (agreedDeliveryDate). An incoming null or invalid date is never a change: the
    //    update branch above does not write it either.
    const sameLastModified =
      existingOrder !== null &&
      existingOrder.platformLastModifiedAt !== null &&
      incomingLmd !== null &&
      incomingLmd.getTime() === existingOrder.platformLastModifiedAt.getTime();
    const baremTimingChanged =
      existingOrder !== null &&
      (isNewInstant(existingOrder.actualShipDate, incomingShipDate) ||
        isNewInstant(existingOrder.agreedDeliveryDate, incomingDeadline));
    if (!sameLastModified || baremTimingChanged) {
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
