// Variant-resolution tick (spec 2026-06-11 §4 D3-D5).
//
// Sıra: (1) yerel first-match — günlük tam senkronla gelmiş variant'ları sıfır
// API çağrısıyla bağlar; (2) hâlâ eşleşmeyenler için mağaza-başına TEKİL
// barkodlarla hedefli vendor sorgusu → mevcut products upsert hattı; (3) tekrar
// eşle + bağla; (4) kalanlara attempts++ ve üstel backoff. Eşleştirme semantiği
// intake ile birebir: (storeId, barcode) first-match (build-calc-check-lines).
// Tick crash-safe: çağıran (index.ts) catch'ler; burada mağaza-başına izolasyon.

import { prisma } from '@pazarsync/db';
import { decryptStoreCredentials, fetchProductsByBarcode } from '@pazarsync/marketplace';
import { captureCostSnapshot } from '@pazarsync/order-sync';
import { applyEstimateOnOrderCreate } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

import { upsertBatch } from './products';

const MAX_BARCODES_PER_STORE_PER_TICK = 25;
const DUE_ITEMS_PER_TICK = 500;
const BACKOFF_BASE_MS = 5 * 60_000; // 5 dk
const BACKOFF_CAP_MS = 24 * 60 * 60_000; // 24 saat

interface DueItem {
  id: string;
  barcode: string | null;
  variantResolutionAttempts: number;
  order: { id: string; storeId: string; organizationId: string };
}

function nextBackoff(attempts: number): Date {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
  return new Date(Date.now() + delay);
}

export async function processVariantResolution(): Promise<void> {
  // Vadesi gelmiş, çözülmemiş satırlar — mağaza başına gruplanır.
  const due: DueItem[] = await prisma.orderItem.findMany({
    where: {
      productVariantId: null,
      barcode: { not: null },
      OR: [{ nextResolutionAt: null }, { nextResolutionAt: { lte: new Date() } }],
    },
    select: {
      id: true,
      barcode: true,
      variantResolutionAttempts: true,
      order: { select: { id: true, storeId: true, organizationId: true } },
    },
    take: DUE_ITEMS_PER_TICK,
  });
  if (due.length === 0) return;

  const byStore = new Map<string, DueItem[]>();
  for (const item of due) {
    const list = byStore.get(item.order.storeId) ?? [];
    list.push(item);
    byStore.set(item.order.storeId, list);
  }

  for (const [storeId, items] of byStore) {
    try {
      await resolveForStore(storeId, items);
    } catch (err) {
      // Mağaza-başına izolasyon: bir mağazanın hatası (ör. vendor 5xx)
      // diğerlerini durdurmaz; satırlar vadeleri değişmediği için sonraki
      // tick'te yeniden ele alınır.
      syncLog.error('resolution.store-failed', {
        storeId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function resolveForStore(storeId: string, items: DueItem[]): Promise<void> {
  // 1) Yerel first-match (ucuz yol — vendor'a gitmeden bağla).
  let remaining = await linkAgainstLocalCatalog(storeId, items);
  if (remaining.length === 0) return;

  // 2) Hedefli vendor sorgusu — tekil barkodlar, tick-başına üst sınırlı.
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const credentials = decryptStoreCredentials(store);
  const distinctBarcodes = [
    ...new Set(remaining.flatMap((i) => (i.barcode === null ? [] : [i.barcode]))),
  ].slice(0, MAX_BARCODES_PER_STORE_PER_TICK);

  for (const barcode of distinctBarcodes) {
    const page = await fetchProductsByBarcode({
      environment: store.environment,
      credentials,
      barcode,
    });
    if (page.batch.length > 0) {
      await upsertBatch(store, page.batch, null);
    }
  }

  // 3) Tekrar eşle; (4) kalanlara backoff.
  remaining = await linkAgainstLocalCatalog(storeId, remaining);
  for (const item of remaining) {
    await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        variantResolutionAttempts: item.variantResolutionAttempts + 1,
        nextResolutionAt: nextBackoff(item.variantResolutionAttempts),
      },
    });
    syncLog.info('resolution.deferred', {
      storeId,
      orderItemId: item.id,
      barcode: item.barcode,
      attempts: item.variantResolutionAttempts + 1,
    });
  }
}

/** Bağlananları listeden düşürür; bağlama + snapshot + estimate tek tx/order. */
async function linkAgainstLocalCatalog(storeId: string, items: DueItem[]): Promise<DueItem[]> {
  const stillUnresolved: DueItem[] = [];
  // Order bazında grupla — snapshot + estimate order-tx'inde koşar.
  const byOrder = new Map<string, DueItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.order.id) ?? [];
    list.push(item);
    byOrder.set(item.order.id, list);
  }

  for (const [orderId, orderItems] of byOrder) {
    await prisma.$transaction(async (tx) => {
      let linkedAny = false;
      for (const item of orderItems) {
        if (item.barcode === null) {
          stillUnresolved.push(item);
          continue;
        }
        const variant = await tx.productVariant.findFirst({
          where: { storeId, barcode: item.barcode },
          select: { id: true },
        });
        if (variant === null) {
          stillUnresolved.push(item);
          continue;
        }
        await tx.orderItem.update({
          where: { id: item.id },
          data: { productVariantId: variant.id },
        });
        await captureCostSnapshot(item.id, tx);
        linkedAny = true;
        syncLog.info('resolution.linked', {
          storeId,
          orderItemId: item.id,
          barcode: item.barcode,
          productVariantId: variant.id,
        });
      }
      if (linkedAny) {
        // Write-once + re-entry-safe: estimatedNetProfit doluysa no-op; eksik
        // snapshot kaldıysa null bırakır, sonraki bağlamada yeniden denenir.
        await applyEstimateOnOrderCreate(orderId, tx);
      }
    });
  }
  return stillUnresolved;
}
